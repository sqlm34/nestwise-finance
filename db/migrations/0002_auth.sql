-- Generated from Better Auth 1.7.12; reviewed, versioned, applied by owner only.
create schema if not exists "nestwise_auth";

create table "nestwise_auth"."user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table "nestwise_auth"."session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "nestwise_auth"."user" ("id") on delete cascade);

create table "nestwise_auth"."account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "nestwise_auth"."user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);

create table "nestwise_auth"."verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table "nestwise_auth"."rateLimit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index "session_userId_idx" on "nestwise_auth"."session" ("userId");

create index "account_userId_idx" on "nestwise_auth"."account" ("userId");

create index "verification_identifier_idx" on "nestwise_auth"."verification" ("identifier");
CREATE ROLE nestwise_auth_api NOLOGIN;
REVOKE ALL ON SCHEMA nestwise_auth FROM PUBLIC;
GRANT USAGE ON SCHEMA nestwise_auth TO nestwise_auth_api;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA nestwise_auth TO nestwise_auth_api;
