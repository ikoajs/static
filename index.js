const fs = require('fs')
const path = require('path')
const mime = require('mime-types')
const { DefinedError } = require('ikoa-utils')
const LruCache = require('lru-cache')

module.exports = function koaStatic({
  dir = process.cwd(),
  gzip = false,
  maxAge = 1200,
  memory = false,
  videoSeparateSize = 3145728,
  setHeader = noop
}) {
  const cache = LruCache({maxAge: maxAge * 1000, max: 500})
  const noCacheTypes = ['text/html']

  // read once
  read(dir, cache)

  return async function(ctx, next) {
    const pathname = ctx.URL.pathname
    const url = pathname.replace('/', path.sep)
    const findPath = `${dir}${url}`
    const stats = cache.get(findPath)
    let stream, range, start, end, type

    if (stats) {
      const length = stats.size
      range = ctx.headers.range
      type = mime.lookup(findPath)

      ctx.type = mime.lookup(findPath)

      // 支持range走range，不支持走下面
      if (range) {
        range = range.replace(/bytes=/, '').split('-')
        start = Number(range[0])
        end = range[1] ? Number(range[1]) : start + videoSeparateSize
        end = Math.min(length - 1, end)

        stream = fs.createReadStream(findPath, { start, end })

        ctx.status = 206
        ctx.set('Content-Range', `bytes ${start}-${end}/${length}`)
        ctx.set('Accept-Ranges', 'bytes')
        ctx.length = end - start + 1

        stream.on('error', err => ctx.onerror(err))
        ctx.body = stream
      } else {
        if (noCacheTypes.includes(type)) {
          ctx.res.setHeader('Cache-Control', 'no-cache')
        } else {
          // https://segmentfault.com/a/1190000006741200
          // 如果已经请求过一次的话 且在缓存有效期内走缓存
          const etag = ctx.header['if-none-match']
          const generatedEtag = getEtag(stats)
          const lastCache = etag == generatedEtag ? cache.get(generatedEtag) : null

          if (lastCache) {
            if (Date.now() - lastCache.cTime < lastCache.maxAge * 1000) {
              ctx.status = 304
              return
            }
          } else {
            ctx.etag = generatedEtag
            ctx.res.setHeader('Cache-Control', `max-age: ${maxAge}`)
            cache.set(generatedEtag, { maxAge: maxAge, cTime: Date.now() })
          }
        }

        if (typeof setHeader === 'function') {
          setHeader.apply(ctx)
        }

        stream = fs.createReadStream(findPath)
        ctx.length = length
        ctx.type = type
        ctx.body = stream
      }
    } else {
      ctx.onerror(new DefinedError({
        name: 'ikoa-static',
        message: `${pathname} not found`,
        status: 404
      }))
    }
    await next()
  }
}

// 生成唯一的标识： 没有stats的情况使用内容md5加密
function getEtag(stats) {
  let mtime = stats.mtime.getTime().toString(16)
  let size = stats.size.toString(16)
  return `"${size}-${mtime}"`
}

function noop() {}

// 返回所有的文件，不包含. 软链接
async function read(file, cache) {
  const stats = fs.statSync(file)

  if (stats.isDirectory()) {
    const files = fs.readdirSync(file)
    files.map(k => read(path.join(file, k), cache))
  } else if (stats.isFile() && !path.basename(file).startsWith('.')) {
    if (!cache.get(file)) cache.set(file, stats)
  }
  return cache
}
