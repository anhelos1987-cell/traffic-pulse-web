import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server/yandex'))
import deploy


class DeploySafetyTests(unittest.TestCase):
    def run_main(self, *args):
        events = []

        def fake_yc(*command):
            events.append(command)
            if command[:3] == ('iam', 'service-account', 'get'):
                return {'id': 'service-account-id'}
            if command[:3] == ('serverless', 'function', 'get'):
                return {'id': 'function-id'}
            return {}

        def fake_version(function, account, secret='', test_users='', live=False):
            events.append(('version', function, account, secret, test_users, live))
            return {'id': 'version-id'}

        output = io.StringIO()
        with patch.object(sys, 'argv', ['deploy.py', *args]), \
             patch.object(deploy, 'yc', side_effect=fake_yc), \
             patch.object(deploy, 'version', side_effect=fake_version), \
             patch.object(deploy.secrets, 'randbelow', return_value=7), \
             patch('sys.stdout', output):
            deploy.main()
        return events, json.loads(output.getvalue())

    def test_requires_exactly_one_publish_mode(self):
        for args in [(), ('--synthetic-test', '--public-disabled')]:
            with self.subTest(args=args), patch.object(sys, 'argv', ['deploy.py', *args]), \
                 patch('sys.stderr', io.StringIO()), self.assertRaises(SystemExit):
                deploy.main()

    def test_synthetic_version_is_private_before_known_key_is_published(self):
        events, result = self.run_main('--synthetic-test')
        deny = ('serverless', 'function', 'deny-unauthenticated-invoke', 'function-id')
        version = ('version', 'function-id', 'service-account-id',
                   'synthetic-cloud-check-not-a-vk-secret', '900000000000007', False)
        self.assertLess(events.index(deny), events.index(version))
        self.assertNotIn(('serverless', 'function', 'allow-unauthenticated-invoke', 'function-id'), events)
        self.assertEqual(result['synthetic_user'], '900000000000007')

    def test_only_secretless_disabled_version_becomes_public(self):
        events, result = self.run_main('--public-disabled')
        version = ('version', 'function-id', 'service-account-id', '', '', False)
        allow = ('serverless', 'function', 'allow-unauthenticated-invoke', 'function-id')
        self.assertLess(events.index(version), events.index(allow))
        self.assertNotIn(('serverless', 'function', 'deny-unauthenticated-invoke', 'function-id'), events)
        self.assertIsNone(result['synthetic_user'])


if __name__ == '__main__':
    unittest.main()
