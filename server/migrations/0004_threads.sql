-- Threads are channels (type 11) below a text channel, optionally started from a message.
ALTER TABLE channels
    ADD COLUMN owner_id          BIGINT REFERENCES users (id) ON DELETE SET NULL,
    ADD COLUMN thread_message_id BIGINT UNIQUE,
    ADD COLUMN archived          BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN message_count     INTEGER NOT NULL DEFAULT 0;
