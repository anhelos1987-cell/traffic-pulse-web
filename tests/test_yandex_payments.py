import base64
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server/yandex'))
from billing_core import Billing, APP_ID, ITEM, PRICE, transition, verify_launch, unique_form
import index

SECRET = 'synthetic-unit-test-secret'
NOW = 1804147200


class MemoryStore:
    def __init__(self):
        self.orders, self.entitlements = {}, {}
    def owned(self, user, test):
        return bool(self.entitlements.get((test, user), {}).get('all_maps'))
    def apply(self, order, test, user, status, now, allowed):
        ent = self.entitlements.get((test, user), {})
        response, write_order, write_entitlement = transition(self.orders.get((test, order)), ent, order, user, status, allowed)
        if write_order:
            self.orders[(test, order)] = {'user_id': user, 'item': ITEM, 'price': PRICE, 'status': status}
        if write_entitlement:
            self.entitlements[(test, user)] = {'order_id': order, 'all_maps': status == 'chargeable'}
        return response


def signed(**overrides):
    p = {'app_id': str(APP_ID), 'user_id': '42', 'receiver_id': '42', 'notification_type': 'order_status_change', 'order_id': '9001', 'status': 'chargeable', 'item': ITEM, 'item_price': '10', **overrides}
    p['sig'] = hashlib.md5((''.join(k + '=' + p[k] for k in sorted(p)) + SECRET).encode()).hexdigest()
    return p


def launch(**overrides):
    p = {'vk_app_id': str(APP_ID), 'vk_user_id': '42', 'vk_ts': str(NOW), 'vk_platform': 'desktop_web', **overrides}
    payload = urlencode(sorted(p.items()), safe='*-._').replace('~', '%7E')
    return payload + '&sign=' + base64.urlsafe_b64encode(hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).digest()).decode().rstrip('=')


class PaymentTests(unittest.TestCase):
    def setUp(self):
        self.store = MemoryStore()
        self.billing = Billing(self.store, SECRET, True, photo_url='https://example.test/item.png', now=lambda: NOW)
    def test_price_catalog_and_signature(self):
        self.assertEqual(self.billing.callback(signed(notification_type='get_item', item_price='1'))['response']['price'], 10)
        for p in [signed(sig='bad'), signed(app_id='123'), signed(item_price='9'), signed(receiver_id='43'), signed(item='other')]:
            self.assertIn('error', self.billing.callback(p))
        self.assertFalse(self.store.owned(42, 0))
    def test_atomic_decision_idempotency_and_restore(self):
        result = self.billing.callback(signed())
        self.assertEqual(result, self.billing.callback(signed()))
        self.assertTrue(Billing(self.store, SECRET, True).entitlements(42)['all_maps'])
        self.assertFalse(self.billing.entitlements(43)['all_maps'])
        self.assertIn('error', self.billing.callback(signed(order_id='9002')))
        self.billing.live = False
        self.assertEqual(result, self.billing.callback(signed()))  # Retry works after sales stopped.
    def test_refunds_tombstones_and_repurchase(self):
        self.billing.callback(signed())
        self.billing.callback(signed(status='refunded'))
        self.billing.callback(signed())
        self.assertFalse(self.store.owned(42, 0))
        self.billing.callback(signed(order_id='9002', status='refunded'))
        self.billing.callback(signed(order_id='9002'))
        self.assertFalse(self.store.owned(42, 0))
        self.billing.callback(signed(order_id='9003'))
        self.billing.callback(signed(order_id='9001', status='refunded'))
        self.assertTrue(self.store.owned(42, 0))
    def test_test_mode_isolation_and_order_mismatch(self):
        b = Billing(self.store, SECRET, False, [42], 'https://example.test/item.png')
        self.assertIn('error', b.callback(signed()))
        self.assertIn('response', b.callback(signed(notification_type='order_status_change_test')))
        self.assertTrue(b.entitlements(42)['all_maps'])
        b.live = True
        self.assertFalse(b.entitlements(42)['all_maps'])
        self.assertIn('error', b.callback(signed(notification_type='order_status_change_test', user_id='43', receiver_id='43')))
    def test_launch_verification_and_duplicates(self):
        self.assertEqual(verify_launch(launch(vk_language='ru~* тест'), SECRET, NOW), 42)
        for p in [launch().replace('vk_user_id=42', 'vk_user_id=43'), launch(vk_app_id='123'), launch(vk_ts='1'), launch() + '&vk_user_id=43']:
            self.assertIsNone(verify_launch(p, SECRET, NOW))
        with self.assertRaises(ValueError):
            unique_form('item=a&item=b')
    def test_http_guards_cors_and_no_secret(self):
        origin = 'https://game.example.test'
        with patch.dict(os.environ, {'VK_ALLOWED_ORIGINS': origin, 'VK_APP_SECRET': ''}):
            def request(path='/api/vkgames/entitlements', method='POST', body='{}', headers=None, **extra):
                return index.handler({'httpMethod': method, 'path': path, 'body': body, 'headers': headers or {'origin': origin, 'content-type': 'application/json'}, **extra}, None)
            self.assertEqual(request()['statusCode'], 503)
            self.assertEqual(request(headers={'origin': 'https://evil.test'})['statusCode'], 403)
            self.assertEqual(request(method='OPTIONS')['headers']['Access-Control-Max-Age'], '86400')
            self.assertEqual(request(body='x'*24001)['statusCode'], 413)
            self.assertEqual(request(method='GET')['statusCode'], 405)
            self.assertEqual(request('/unknown')['statusCode'], 404)
        with patch.dict(os.environ, {'VK_APP_SECRET': SECRET}), patch.object(index, 'service', return_value=self.billing), patch('billing_core.time.time', return_value=NOW):
            event = {'httpMethod': 'POST', 'path': '/api/vkgames/entitlements', 'headers': {'content-type': 'application/json'}, 'body': json.dumps({'launch_params': launch()})}
            self.assertFalse(json.loads(index.handler(event, None)['body'])['all_maps'])
            event['body'] = json.dumps({'launch_params': 'vk_user_id=42'})
            self.assertEqual(index.handler(event, None)['statusCode'], 401)
            with patch.object(self.store, 'owned', side_effect=RuntimeError('secret leaked?')):
                event['body'] = json.dumps({'launch_params': launch()})
                result = index.handler(event, None)
                self.assertEqual(result['statusCode'], 503)
                self.assertNotIn('secret', result['body'])


if __name__ == '__main__':
    unittest.main()
