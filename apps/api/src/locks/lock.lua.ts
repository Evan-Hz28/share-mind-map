export const acquireLockLua = `
local active = redis.call('HGET', KEYS[1], 'active')
local currentGeneration = tonumber(redis.call('HGET', KEYS[1], 'generation') or '0')
if active == '1' then
  return {0, currentGeneration, redis.call('TTL', KEYS[1])}
end
local generation = currentGeneration + 1
redis.call('HSET', KEYS[1],
  'documentId', ARGV[1],
  'userId', ARGV[2],
  'platformSessionId', ARGV[3],
  'browserEditSessionId', ARGV[4],
  'tokenDigest', ARGV[5],
  'generation', generation,
  'heartbeatAt', ARGV[6],
  'active', '1')
redis.call('EXPIRE', KEYS[1], ARGV[7])
return {1, generation, ARGV[7]}
`;

export const heartbeatLockLua = `
local active = redis.call('HGET', KEYS[1], 'active')
local generation = redis.call('HGET', KEYS[1], 'generation') or '0'
if active ~= '1' or
   redis.call('HGET', KEYS[1], 'userId') ~= ARGV[1] or
   redis.call('HGET', KEYS[1], 'platformSessionId') ~= ARGV[2] or
   redis.call('HGET', KEYS[1], 'browserEditSessionId') ~= ARGV[3] or
   redis.call('HGET', KEYS[1], 'tokenDigest') ~= ARGV[4] or
   generation ~= ARGV[5] then
  return {0, generation}
end
redis.call('HSET', KEYS[1], 'heartbeatAt', ARGV[6])
redis.call('EXPIRE', KEYS[1], ARGV[7])
return {1, generation, ARGV[7]}
`;

export const releaseLockLua = `
if redis.call('EXISTS', KEYS[1]) == 0 then return {1, '0'} end
local generation = redis.call('HGET', KEYS[1], 'generation') or '0'
if redis.call('HGET', KEYS[1], 'active') ~= '1' then
  return {1, generation}
end
if
   redis.call('HGET', KEYS[1], 'userId') ~= ARGV[1] or
   redis.call('HGET', KEYS[1], 'platformSessionId') ~= ARGV[2] or
   redis.call('HGET', KEYS[1], 'browserEditSessionId') ~= ARGV[3] or
   redis.call('HGET', KEYS[1], 'tokenDigest') ~= ARGV[4] or
   generation ~= ARGV[5] then
  return {0, generation}
end
redis.call('HSET', KEYS[1], 'active', '0')
redis.call('EXPIRE', KEYS[1], 60)
return {1, generation}
`;

export const forceReleaseLockLua = `
local generation = tonumber(redis.call('HGET', KEYS[1], 'generation') or '0')
if redis.call('HGET', KEYS[1], 'active') ~= '1' then
  return {0, generation}
end
generation = generation + 1
redis.call('HSET', KEYS[1], 'active', '0', 'generation', generation)
redis.call('EXPIRE', KEYS[1], 60)
return {1, generation}
`;
