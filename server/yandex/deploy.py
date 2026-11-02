"""Run inside an authenticated Yandex Cloud Shell. No permanent access keys."""
import argparse
import json
from pathlib import Path
import secrets
import subprocess
import zipfile

HERE = Path(__file__).resolve().parent
FOLDER = 'b1gjqej23tbedjb0s4sj'
DATABASE_ID = 'etnt0bcmvqgeeup0cr0f'
DATABASE = '/ru-central1/b1g65fim8vrne75gd38r/' + DATABASE_ID
ENDPOINT = 'grpcs://ydb.serverless.yandexcloud.net:2135'
NAME = 'traffic-pulse-vk-payments'
ORIGIN = 'https://traffic-pulse-vkgames-edge.anhelos1987.workers.dev'


def yc(*args):
    output = subprocess.check_output(['yc', *args, '--folder-id', FOLDER, '--format', 'json'], text=True)
    return json.loads(output) if output.strip() else {}


def build():
    archive = HERE / 'function.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
        for name in ('index.py', 'billing_core.py', 'ydb_store.py', 'requirements.txt'):
            z.write(HERE / name, name)
    return archive


def version(function, account, secret='', test_users='', live=False):
    env = {'YDB_ENDPOINT': ENDPOINT, 'YDB_DATABASE': DATABASE, 'VK_ALLOWED_ORIGINS': ORIGIN,
           'VK_PAYMENTS_LIVE': str(live).lower(), 'VK_TEST_USERS': test_users,
           'VK_ITEM_PHOTO_URL': ORIGIN + '/all-maps.png', 'VK_APP_SECRET': secret}
    # Synthetic test secret only. Real secrets are supplied through the console,
    # never command arguments, source code, shell history or GitHub.
    return yc('serverless', 'function', 'version', 'create', '--function-id', function,
              '--runtime', 'python312', '--entrypoint', 'index.handler', '--memory', '256m',
              '--execution-timeout', '10s', '--concurrency', '1', '--service-account-id', account,
              '--source-path', str(build()), '--environment', ','.join(k + '=' + v for k, v in env.items() if v), '--min-log-level', 'error')


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--bootstrap', action='store_true')
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument('--synthetic-test', action='store_true')
    mode.add_argument('--public-disabled', action='store_true')
    mode.add_argument('--private-disabled', action='store_true')
    args = p.parse_args()
    account = yc('iam', 'service-account', 'get', '--name', NAME)['id']
    function = yc('serverless', 'function', 'get', '--name', NAME)['id']
    if args.bootstrap:
        # Database-scoped role, never folder/cloud admin.
        yc('ydb', 'database', 'add-access-binding', DATABASE_ID, '--role', 'ydb.editor', '--subject', 'serviceAccount:' + account)
        import ydb
        token = subprocess.check_output(['yc', 'iam', 'create-token'], text=True).strip()
        with ydb.Driver(endpoint=ENDPOINT, database=DATABASE, credentials=ydb.AccessTokenCredentials(token)) as driver:
            driver.wait(timeout=10, fail_fast=True)
            session = driver.table_client.session().create()
            try:
                for sql in (HERE / 'bootstrap.sql').read_text().split(';'):
                    if sql.strip():
                        session.execute_scheme(sql)
            finally:
                session.delete()
        print(json.dumps({'schema_ready': True}))
    synthetic_user = ''
    if args.synthetic_test or args.private_disabled:
        # Function access bindings persist across versions. Revoke public access
        # before publishing a known synthetic key or a deliberately private version.
        yc('serverless', 'function', 'deny-unauthenticated-invoke', function)
    if args.synthetic_test:
        synthetic_user = str(900_000_000_000_000 + secrets.randbelow(99_999_999_999_999))
        v = version(function, account, 'synthetic-cloud-check-not-a-vk-secret', synthetic_user)
    else:
        v = version(function, account)
    yc('serverless', 'function', 'set-scaling-policy', function, '--tag', '$latest', '--zone-instances-limit', '1', '--zone-requests-limit', '2')
    if args.public_disabled:
        yc('serverless', 'function', 'allow-unauthenticated-invoke', function)
    print(json.dumps({'function_id': function, 'service_account_id': account, 'version_id': v['id'], 'endpoint': 'https://functions.yandexcloud.net/' + function, 'live': False, 'synthetic_test': args.synthetic_test, 'public_invocation': args.public_disabled, 'synthetic_user': synthetic_user or None}))


if __name__ == '__main__':
    main()
