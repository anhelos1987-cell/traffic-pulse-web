"""Two point reads and atomic writes; no scans, per-request connections or file DB."""
import os
import threading
import ydb
import ydb.iam
from billing_core import ITEM, PRICE, transition

DECLARE = 'DECLARE $test AS Uint32; DECLARE $user AS Uint64; '
READ = DECLARE + 'SELECT order_id, all_maps FROM tp_vk_entitlements WHERE test=$test AND user_id=$user;'
READ_ORDER = DECLARE + 'DECLARE $order AS Uint64; SELECT user_id,item,price,status FROM tp_vk_orders WHERE test=$test AND order_id=$order; SELECT order_id,all_maps FROM tp_vk_entitlements WHERE test=$test AND user_id=$user;'
WRITE_ORDER = DECLARE + '''DECLARE $order AS Uint64; DECLARE $item AS Utf8; DECLARE $price AS Uint32; DECLARE $status AS Utf8; DECLARE $now AS Uint64;
UPSERT INTO tp_vk_orders (test,order_id,user_id,item,price,status,updated_at) VALUES ($test,$order,$user,$item,$price,$status,$now);'''
WRITE_ENTITLEMENT = DECLARE + '''DECLARE $order AS Uint64; DECLARE $owned AS Bool; DECLARE $now AS Uint64;
UPSERT INTO tp_vk_entitlements (test,user_id,order_id,all_maps,updated_at) VALUES ($test,$user,$order,$owned,$now);'''


class YDBStore:
    def __init__(self):
        self.lock, self.driver, self.pool = threading.Lock(), None, None
        self.settings = ydb.BaseRequestSettings().with_timeout(3).with_operation_timeout(2)
        self.retries = ydb.RetrySettings(max_retries=2, max_session_acquire_timeout=2, backoff_ceiling=2, backoff_slot_duration=.05, idempotent=True)

    def connect(self):
        with self.lock:
            if self.pool is None:
                driver = ydb.Driver(endpoint=os.environ['YDB_ENDPOINT'], database=os.environ['YDB_DATABASE'], credentials=ydb.iam.MetadataUrlCredentials())
                try:
                    driver.wait(timeout=4, fail_fast=True)
                except Exception:
                    driver.stop()
                    raise
                self.driver, self.pool = driver, ydb.SessionPool(driver, size=2)
        return self.pool

    def execute(self, session, tx, query, params, commit=False):
        return tx.execute(session.prepare(query, settings=self.settings), params, commit_tx=commit, settings=self.settings)

    def owned(self, user, test):
        def run(session):
            r = self.execute(session, session.transaction(ydb.SerializableReadWrite()), READ, {'$test': test, '$user': user}, True)
            return bool(r[0].rows and r[0].rows[0]['all_maps'])
        return self.connect().retry_operation_sync(run, retry_settings=self.retries)

    def apply(self, order, test, user, status, now, allowed):
        def run(session):
            with session.transaction(ydb.SerializableReadWrite()) as tx:
                r = self.execute(session, tx, READ_ORDER, {'$test': test, '$user': user, '$order': order})
                previous = dict(r[0].rows[0]) if r[0].rows else None
                entitlement = dict(r[1].rows[0]) if r[1].rows else {}
                response, write_order, write_entitlement = transition(previous, entitlement, order, user, status, allowed)
                if write_order:
                    self.execute(session, tx, WRITE_ORDER, {'$test': test, '$user': user, '$order': order, '$item': ITEM, '$price': PRICE, '$status': status, '$now': now})
                if write_entitlement:
                    self.execute(session, tx, WRITE_ENTITLEMENT, {'$test': test, '$user': user, '$order': order, '$owned': status == 'chargeable', '$now': now})
                tx.commit(settings=self.settings)
                return response
        return self.connect().retry_operation_sync(run, retry_settings=self.retries)
