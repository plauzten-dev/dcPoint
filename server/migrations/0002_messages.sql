-- Phase 2: messages, attachments, reactions, read states.

CREATE TABLE messages (
    id               BIGINT PRIMARY KEY,
    channel_id       BIGINT   NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
    author_id        BIGINT REFERENCES users (id) ON DELETE SET NULL,
    content          TEXT     NOT NULL DEFAULT '',
    type             SMALLINT NOT NULL DEFAULT 0, -- 0 = default, 19 = reply
    reply_to_id      BIGINT,                      -- no FK: replies survive deleted parents
    edited_at        TIMESTAMPTZ,
    pinned           BOOLEAN  NOT NULL DEFAULT false,
    mention_everyone BOOLEAN  NOT NULL DEFAULT false,
    mention_ids      BIGINT[] NOT NULL DEFAULT '{}',
    mention_role_ids BIGINT[] NOT NULL DEFAULT '{}',
    embeds           JSONB    NOT NULL DEFAULT '[]',
    flags            INTEGER  NOT NULL DEFAULT 0, -- bit 0: marked as solution (knowledge base)
    search           TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED
);
CREATE INDEX messages_channel_id_idx ON messages (channel_id, id DESC);
CREATE INDEX messages_author_id_idx ON messages (author_id);
CREATE INDEX messages_pinned_idx ON messages (channel_id) WHERE pinned;
CREATE INDEX messages_search_idx ON messages USING GIN (search);

CREATE TABLE attachments (
    id           BIGINT PRIMARY KEY,
    message_id   BIGINT REFERENCES messages (id) ON DELETE CASCADE,
    channel_id   BIGINT  NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
    filename     TEXT    NOT NULL,
    content_type TEXT    NOT NULL,
    size         BIGINT  NOT NULL,
    width        INTEGER,
    height       INTEGER,
    spoiler      BOOLEAN NOT NULL DEFAULT false,
    -- unguessable path component: attachment URLs are capability URLs that never expire
    url_token    TEXT    NOT NULL
);
CREATE INDEX attachments_message_id_idx ON attachments (message_id);

CREATE TABLE reactions (
    message_id BIGINT      NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
    emoji      TEXT        NOT NULL,
    user_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, emoji, user_id)
);

CREATE TABLE read_states (
    user_id         BIGINT  NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    channel_id      BIGINT  NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
    last_message_id BIGINT  NOT NULL DEFAULT 0,
    mention_count   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, channel_id)
);
CREATE INDEX read_states_channel_id_idx ON read_states (channel_id);
