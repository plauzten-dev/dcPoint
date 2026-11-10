-- Phase 1: accounts, sessions, guilds, roles, members, channels, overwrites, invites.

CREATE TABLE users (
    id                       BIGINT PRIMARY KEY,
    username                 TEXT        NOT NULL,
    email                    TEXT        NOT NULL,
    display_name             TEXT,
    password_hash            TEXT        NOT NULL,
    avatar                   TEXT,
    banner                   TEXT,
    bio                      TEXT        NOT NULL DEFAULT '',
    pronouns                 TEXT        NOT NULL DEFAULT '',
    accent_color             INTEGER,
    status                   TEXT        NOT NULL DEFAULT 'online'
                             CHECK (status IN ('online', 'idle', 'dnd', 'invisible')),
    custom_status_text       TEXT,
    custom_status_emoji      TEXT,
    custom_status_expires_at TIMESTAMPTZ,
    totp_secret              TEXT,
    totp_last_step           BIGINT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_key ON users (lower(username));
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE sessions (
    id           BIGINT PRIMARY KEY,
    user_id      BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash   BYTEA       NOT NULL,
    user_agent   TEXT,
    ip           TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

CREATE TABLE guilds (
    id          BIGINT PRIMARY KEY,
    name        TEXT        NOT NULL,
    icon        TEXT,
    description TEXT,
    owner_id    BIGINT      NOT NULL REFERENCES users (id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX guilds_owner_id_idx ON guilds (owner_id);

CREATE TABLE roles (
    id          BIGINT PRIMARY KEY,
    guild_id    BIGINT  NOT NULL REFERENCES guilds (id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    color       INTEGER NOT NULL DEFAULT 0,
    hoist       BOOLEAN NOT NULL DEFAULT false,
    mentionable BOOLEAN NOT NULL DEFAULT false,
    position    INTEGER NOT NULL DEFAULT 0,
    permissions BIGINT  NOT NULL DEFAULT 0
);
CREATE INDEX roles_guild_id_idx ON roles (guild_id);

CREATE TABLE members (
    guild_id                     BIGINT      NOT NULL REFERENCES guilds (id) ON DELETE CASCADE,
    user_id                      BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    nick                         TEXT,
    joined_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    communication_disabled_until TIMESTAMPTZ,
    PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX members_user_id_idx ON members (user_id);

CREATE TABLE member_roles (
    guild_id BIGINT NOT NULL,
    user_id  BIGINT NOT NULL,
    role_id  BIGINT NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
    PRIMARY KEY (guild_id, user_id, role_id),
    FOREIGN KEY (guild_id, user_id) REFERENCES members (guild_id, user_id) ON DELETE CASCADE
);
CREATE INDEX member_roles_role_id_idx ON member_roles (role_id);

CREATE TABLE channels (
    id                  BIGINT PRIMARY KEY,
    guild_id            BIGINT REFERENCES guilds (id) ON DELETE CASCADE,
    type                SMALLINT    NOT NULL,
    name                TEXT        NOT NULL DEFAULT '',
    topic               TEXT,
    position            INTEGER     NOT NULL DEFAULT 0,
    parent_id           BIGINT REFERENCES channels (id) ON DELETE SET NULL,
    nsfw                BOOLEAN     NOT NULL DEFAULT false,
    bitrate             INTEGER,
    user_limit          INTEGER,
    rate_limit_per_user INTEGER     NOT NULL DEFAULT 0,
    last_message_id     BIGINT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX channels_guild_id_idx ON channels (guild_id);
CREATE INDEX channels_parent_id_idx ON channels (parent_id);

CREATE TABLE permission_overwrites (
    channel_id BIGINT   NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
    target_id  BIGINT   NOT NULL,
    kind       SMALLINT NOT NULL CHECK (kind IN (0, 1)), -- 0 = role, 1 = member
    allow      BIGINT   NOT NULL DEFAULT 0,
    deny       BIGINT   NOT NULL DEFAULT 0,
    PRIMARY KEY (channel_id, target_id)
);

CREATE TABLE invites (
    code       TEXT PRIMARY KEY,
    guild_id   BIGINT      NOT NULL REFERENCES guilds (id) ON DELETE CASCADE,
    channel_id BIGINT      NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
    inviter_id BIGINT REFERENCES users (id) ON DELETE SET NULL,
    max_uses   INTEGER     NOT NULL DEFAULT 0,
    uses       INTEGER     NOT NULL DEFAULT 0,
    max_age    INTEGER     NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ
);
CREATE INDEX invites_guild_id_idx ON invites (guild_id);
