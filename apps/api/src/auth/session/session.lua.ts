export const createSessionLua = `
local session_key = KEYS[1]
local user_key = KEYS[2]
local ttl = tonumber(ARGV[2])

if redis.call("EXISTS", session_key) == 1 then
  return 0
end

redis.call("SET", session_key, ARGV[1], "EX", ttl)
redis.call("SADD", user_key, session_key)
local user_ttl = redis.call("TTL", user_key)
if user_ttl < ttl then
  redis.call("EXPIRE", user_key, ttl)
end
return 1
`;

export const revokeSessionLua = `
local session_key = KEYS[1]
local value = redis.call("GET", session_key)
if not value then
  return 0
end

local ok, session = pcall(cjson.decode, value)
redis.call("DEL", session_key)
if ok and session["userId"] then
  local user_key = ARGV[1] .. session["userId"]
  redis.call("SREM", user_key, session_key)
  if redis.call("SCARD", user_key) == 0 then
    redis.call("DEL", user_key)
  end
end
return 1
`;

export const revokeAllSessionsLua = `
local user_key = KEYS[1]
local session_keys = redis.call("SMEMBERS", user_key)
for _, session_key in ipairs(session_keys) do
  redis.call("DEL", session_key)
end
redis.call("DEL", user_key)
return #session_keys
`;

export const rotateSessionCsrfLua = `
local session_key = KEYS[1]
local value = redis.call("GET", session_key)
if not value then
  return 0
end

local ttl = redis.call("PTTL", session_key)
if ttl <= 0 then
  return 0
end

local session = cjson.decode(value)
session["csrfDigest"] = ARGV[1]
redis.call("SET", session_key, cjson.encode(session), "PX", ttl)
return 1
`;
