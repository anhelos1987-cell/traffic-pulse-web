"""VK Games payment rules. No network, logs or browser-trusted entitlements."""
import base64
import hashlib
import hmac
import re
import time
from urllib.parse import parse_qsl, urlencode

APP_ID = 54870403
ITEM = 'unlock_all_maps'
PRICE = 10


def error(code, message, critical=True):
    return {'error': {'error_code': code, 'error_msg': message, 'critical': critical}}


def positive_id(value):
    value = str(value or '')
    return int(value) if re.fullmatch(r'[1-9][0-9]{0,15}', value) and int(value) <= 9007199254740991 else None


def unique_form(text):
    pairs = parse_qsl(text, keep_blank_values=True, max_num_fields=64)
    result = {}
    for key, value in pairs:
        if key in result or len(key) > 128 or len(value) > 4096:
            raise ValueError('Invalid form')
        result[key] = value
    return result


def verify_launch(text, secret, now=None):
    if not secret or not isinstance(text, str) or len(text) > 12000:
        return None
    try:
        p = unique_form(text)
        uid = positive_id(p.get('vk_user_id'))
        seconds = int(time.time() if now is None else now)
        ts = int(p.get('vk_ts', '0'))
        if p.get('vk_app_id') != str(APP_ID) or not uid or not seconds - 86400 <= ts <= seconds + 300:
            return None
        payload = urlencode(sorted((k, v) for k, v in p.items() if k.startswith('vk_')), safe='*-._').replace('~', '%7E')
        signature = base64.urlsafe_b64encode(hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest()).decode().rstrip('=')
        return uid if hmac.compare_digest(signature, p.get('sign', '')) else None
    except (ValueError, TypeError):
        return None


def verify_callback(p, secret):
    sig = p.get('sig', '')
    if not secret or not re.fullmatch('[a-f0-9]{32}', sig):
        return False
    payload = ''.join(k + '=' + p[k] for k in sorted(p) if k != 'sig') + secret
    return hmac.compare_digest(hashlib.md5(payload.encode()).hexdigest(), sig)


class Billing:
    def __init__(self, store, secret='', live=False, test_users=(), photo_url='', now=time.time):
        self.store, self.secret, self.live = store, secret, live
        self.test_users, self.photo_url, self.now = set(test_users), photo_url, now

    def purchasable(self, user, test):
        return bool(self.secret and self.photo_url.startswith('https://') and (user in self.test_users if test else self.live))

    def entitlements(self, user):
        test = int(user in self.test_users)
        owned = self.store.owned(user, 0) or (test and self.store.owned(user, 1))
        purchasable = self.purchasable(user, 0) or (test and self.purchasable(user, 1))
        return {'app_id': APP_ID, 'user_id': user, 'item': ITEM, 'price_votes': PRICE,
                'all_maps': bool(owned), 'purchasable': bool(purchasable)}

    def callback(self, p):
        if not verify_callback(p, self.secret) or p.get('app_id') != str(APP_ID):
            return error(10, 'Invalid signature or application')
        kind = p.get('notification_type', '')
        test = int(kind.endswith('_test'))
        if test:
            kind = kind[:-5]
        user = positive_id(p.get('user_id'))
        if not user or positive_id(p.get('receiver_id', p.get('user_id'))) != user:
            return error(10, 'Invalid recipient')
        if kind == 'get_item':
            if p.get('item') != ITEM:
                return error(20, 'Unknown product')
            if not self.purchasable(user, test):
                return error(20, 'Purchases unavailable')
            if self.store.owned(user, test):
                return error(20, 'Product already purchased')
            return {'response': {'item_id': ITEM, 'title': 'Открыть все карты', 'photo_url': self.photo_url, 'price': PRICE, 'expiration': 0}}
        if kind != 'order_status_change':
            return error(1, 'Unsupported notification')
        order = positive_id(p.get('order_id'))
        status = p.get('status')
        if not order or p.get('item') != ITEM or p.get('item_id', ITEM) != ITEM or p.get('item_price') != str(PRICE) or status not in ('chargeable', 'refunded'):
            return error(20, 'Invalid order')
        # Even when new sales are disabled, acknowledge retries of durable orders.
        return self.store.apply(order, test, user, status, int(self.now()), self.purchasable(user, test))


def transition(previous, entitlement, order, user, status, allowed):
    """Pure decision executed inside the same serializable DB transaction."""
    if previous:
        if previous['user_id'] != user or previous['item'] != ITEM or previous['price'] != PRICE:
            return error(10, 'Order mismatch'), False, False
        if status == 'refunded' and previous['status'] != 'refunded':
            return {'response': {'order_id': order}}, True, entitlement.get('order_id') == order
        return {'response': {'order_id': order}}, False, False
    if status == 'chargeable':
        if not allowed:
            return error(20, 'Purchases unavailable'), False, False
        if entitlement.get('all_maps'):
            return error(20, 'Product already purchased'), False, False
    return {'response': {'order_id': order}}, True, status == 'chargeable'
