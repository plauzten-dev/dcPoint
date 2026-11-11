-- Custom emojis per guild (usable everywhere - no paywall).
CREATE TABLE emojis (
    id         BIGINT PRIMARY KEY,
    guild_id   BIGINT      NOT NULL REFERENCES guilds (id) ON DELETE CASCADE,
    name       TEXT        NOT NULL,
    animated   BOOLEAN     NOT NULL DEFAULT false,
    creator_id BIGINT REFERENCES users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX emojis_guild_name_key ON emojis (guild_id, lower(name));
