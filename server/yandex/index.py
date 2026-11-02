"""HTTP-compatible Yandex Cloud Functions entrypoint. Never logs request data."""
import base64
import json
import os
import time
import threading
from billing_core import Billing, APP_ID, unique_form, verify_launch, error

_service = None
_service_lock = threading.Lock()
_limits = {}
_rate_lock = threading.Lock()


def service():
    global _service
    with _service_lock:
        if _service is None:
            from ydb_store import YDBStore
            users = [int(x) for x in os.getenv('VK_TEST_USERS', '').split(',') if x.strip().isdigit()]
            _service = Billing(YDBStore(), os.getenv('VK_APP_SECRET', ''), os.getenv('VK_PAYMENTS_LIVE') == 'true', users, os.getenv('VK_ITEM_PHOTO_URL', ''))
    return _service


def rate(user):
    # Bounded best-effort per-instance protection, not a global spending cap.
    bucket = int(time.time() // 60)
    with _rate_lock:
        if len(_limits) > 2000:
            _limits.clear()
        old_bucket, count = _limits.get(user, (bucket, 0))
        count = count + 1 if old_bucket == bucket else 1
        _limits[user] = (bucket, count)
        return count <= 12


def response(data, status=200, headers=None):
    return {'statusCode': status, 'headers': {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', **(headers or {})}, 'body': json.dumps(data, ensure_ascii=False, separators=(',', ':')), 'isBase64Encoded': False}


def handler(event, context):
    method = event.get('httpMethod', '')
    headers = {k.lower(): str(v) for k, v in (event.get('headers') or {}).items()}
    path = event.get('path') or (event.get('requestContext') or {}).get('path') or ''
    # Direct HTTPS function invocations have no URL path. Avoid a paid API Gateway:
    # VK posts a form; our client posts JSON. Neither route trusts body-supplied URLs.
    if not path:
        path = '/health' if method == 'GET' else '/api/vkgames/callback' if headers.get('content-type', '').startswith('application/x-www-form-urlencoded') else '/api/vkgames/entitlements'
    origin = headers.get('origin')
    origins = set(os.getenv('VK_ALLOWED_ORIGINS', '').split(',')) - {''}
    cors = {'Access-Control-Allow-Origin': origin, 'Vary': 'Origin'} if origin in origins else {}
    if method == 'GET' and path in ('/health', '/'):
        return response({'ok': True, 'app_id': APP_ID, 'payments_configured': bool(os.getenv('VK_APP_SECRET')), 'live_enabled': os.getenv('VK_PAYMENTS_LIVE') == 'true'})
    if path not in ('/api/vkgames/callback', '/api/vkgames/entitlements'):
        return response({'error': 'not_found'}, 404)
    callback = path.endswith('/callback')
    if not callback and origin and origin not in origins:
        return response({'error': 'origin_not_allowed'}, 403)
    if not callback and method == 'OPTIONS':
        return response({}, 204, {**cors, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400'})
    if method != 'POST':
        return response({'error': 'method_not_allowed'}, 405, cors)
    try:
        raw = event.get('body') or ''
        if not isinstance(raw, str) or len(raw) > 24000:
            return response({'error': 'too_large'}, 413, cors)
        raw = base64.b64decode(raw, validate=True).decode() if event.get('isBase64Encoded') else raw
        if len(raw.encode()) > 16384:
            return response({'error': 'too_large'}, 413, cors)
        content_type = headers.get('content-type', '')
        if callback:
            if not content_type.startswith('application/x-www-form-urlencoded'):
                return response(error(1, 'Form required'), 400)
            if not os.getenv('VK_APP_SECRET'):
                return response(error(1, 'Payments not configured', False), 503)
            return response(service().callback(unique_form(raw)))
        if not content_type.startswith('application/json'):
            return response({'error': 'json_required'}, 400, cors)
        body = json.loads(raw)
        if not isinstance(body, dict):
            return response({'error': 'invalid_json'}, 400, cors)
        if not os.getenv('VK_APP_SECRET'):
            return response({'error': 'payments_not_configured'}, 503, cors)
        user = verify_launch(body.get('launch_params'), os.environ['VK_APP_SECRET'])
        if not user:
            return response({'error': 'invalid_vk_session'}, 401, cors)
        if not rate(user):
            return response({'error': 'rate_limited'}, 429, {**cors, 'Retry-After': '60'})
        return response(service().entitlements(user), headers=cors)
    except (ValueError, TypeError, UnicodeError):
        return response(error(1, 'Invalid notification') if callback else {'error': 'invalid_request'}, 400, cors)
    except Exception:
        # Do not include SDK exceptions: they can contain bound request parameters.
        return response(error(1, 'Temporary payment error', False) if callback else {'error': 'verification_unavailable'}, 503, {**cors, 'Retry-After': '5'})
