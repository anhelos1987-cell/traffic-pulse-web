-- Run once, never on a player request. Separate tables within the existing RU database.
CREATE TABLE IF NOT EXISTS tp_vk_orders (
 test Uint32 NOT NULL,
 order_id Uint64 NOT NULL,
 user_id Uint64,
 item Utf8,
 price Uint32,
 status Utf8,
 updated_at Uint64,
 PRIMARY KEY (test, order_id)
);
CREATE TABLE IF NOT EXISTS tp_vk_entitlements (
 test Uint32 NOT NULL,
 user_id Uint64 NOT NULL,
 order_id Uint64,
 all_maps Bool,
 updated_at Uint64,
 PRIMARY KEY (test, user_id)
);
