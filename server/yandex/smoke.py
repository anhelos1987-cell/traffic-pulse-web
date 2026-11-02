"""Closed-function integration test with synthetic data, never real VK money."""
import argparse
import base64
import hashlib
import hmac
import json
import statistics
import subprocess
import time
from urllib.parse import urlencode
from deploy import yc, NAME, FOLDER
from billing_core import APP_ID, ITEM, positive_id

SECRET = 'synthetic-cloud-check-not-a-vk-secret'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--user', required=True, help='synthetic_user printed by deploy.py')
    args = parser.parse_args()
    assert positive_id(args.user), 'Invalid synthetic user'
    user = args.user
    order = args.user
    function = yc('serverless', 'function', 'get', '--name', NAME)['id']
    durations = []
    def invoke(event):
        start = time.monotonic()
        raw = subprocess.check_output(['yc', 'serverless', 'function', 'invoke', function, '--data', json.dumps(event), '--folder-id', FOLDER], text=True)
        durations.append(time.monotonic() - start)
        result = json.loads(raw)
        assert result['statusCode'] == 200, result
        return json.loads(result['body'])
    health = invoke({'httpMethod': 'GET'})
    assert health['payments_configured'] and not health['live_enabled'], 'This test requires the private synthetic configuration'
    def callback(**overrides):
        p = {'app_id': str(APP_ID), 'user_id': user, 'receiver_id': user, 'notification_type': 'order_status_change_test', 'order_id': order, 'status': 'chargeable', 'item': ITEM, 'item_price': '10', **overrides}
        p['sig'] = hashlib.md5((''.join(k + '=' + p[k] for k in sorted(p)) + SECRET).encode()).hexdigest()
        return invoke({'httpMethod': 'POST', 'headers': {'Content-Type': 'application/x-www-form-urlencoded'}, 'body': urlencode(p)})
    def entitlement(user=user):
        p = {'vk_app_id': str(APP_ID), 'vk_user_id': user, 'vk_ts': str(int(time.time())), 'vk_platform': 'desktop_web'}
        q = urlencode(sorted(p.items()))
        sign = base64.urlsafe_b64encode(hmac.new(SECRET.encode(), q.encode(), hashlib.sha256).digest()).decode().rstrip('=')
        return invoke({'httpMethod': 'POST', 'headers': {'Content-Type': 'application/json'}, 'body': json.dumps({'launch_params': q + '&sign=' + sign})})
    assert not entitlement()['all_maps']
    assert callback(notification_type='get_item_test')['response']['price'] == 10
    assert 'error' in callback(item_price='9')
    a = callback()
    assert a == callback() and a['response']['order_id'] == int(order)
    assert entitlement()['all_maps']
    assert not entitlement(str(int(user) + 1))['all_maps']
    assert 'response' in callback(status='refunded')
    assert not entitlement()['all_maps']
    assert 'response' in callback()
    assert not entitlement()['all_maps']
    print(json.dumps({'synthetic_smoke_passed': True, 'function_id': function, 'invocations': len(durations), 'cli_roundtrip_median_seconds': round(statistics.median(durations), 3), 'actual_vk_payment_tested': False}))


if __name__ == '__main__':
    main()
