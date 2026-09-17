export const recordLoginFailureLua = `
local time = redis.call("TIME")
local now = tonumber(time[1])
local window = tonumber(ARGV[1])
local result = {}

for index = 1, 2 do
  local key = KEYS[index]
  local count = redis.call("HINCRBY", key, "count", 1)
  local reset_at
  if count == 1 then
    reset_at = now + window
    redis.call("HSET", key, "resetAt", reset_at)
    redis.call("EXPIREAT", key, reset_at)
  else
    reset_at = tonumber(redis.call("HGET", key, "resetAt"))
  end
  table.insert(result, count)
  table.insert(result, math.max(1, reset_at - now))
end

return result
`;

export const assertLoginAllowedLua = `
local time = redis.call("TIME")
local now = tonumber(time[1])
local blocked = 0
local retry_after = 0

for index = 1, 2 do
  local count = tonumber(redis.call("HGET", KEYS[index], "count") or "0")
  local reset_at = tonumber(redis.call("HGET", KEYS[index], "resetAt") or "0")
  local limit = tonumber(ARGV[index])
  if count >= limit and reset_at > now then
    blocked = 1
    retry_after = math.max(retry_after, reset_at - now)
  end
end

return { blocked, math.max(1, retry_after) }
`;
