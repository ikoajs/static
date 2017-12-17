const fs = require('mz/fs')
const path = require('path')
const LruCache = require('lru-cache')
const mime = require('mime-types')
const { DefinedError } = require('ikoa-utils')

module.exports = function koaStatic({
  dir = process.cwd(),
  gzip = false,
  maxAge = 0,
  memory = false,
  videoSeparateSize = 1048576
}) {
  let cache = LruCache({ max: 1000,maxAge: 3000 * 60 * 60 })
  return async function (ctx,next) {
    const files = await read(dir,cache)
    const pathname = ctx.URL.pathname
    const url = pathname.replace('/',path.sep)
    const findPath = `${dir}${url}`
    const stats = cache.get(findPath)
    let stream,range,start,end,size,type

    if (stats) {
      const length = stats.size
      range = ctx.headers.range
      type = mime.lookup(findPath)

      ctx.type = mime.lookup(findPath)

      // 支持range走range，不支持走下面
      if (range) {
        range = range.replace(/bytes=/,'').split('-')
        start = Number(range[0])
        end = range[1] ? Number(range[1]) : start + videoSeparateSize
        end = Math.min(length - 1,end)

        stream = fs.createReadStream(findPath,{ start,end })

        ctx.status = 206
        ctx.set('Content-Range',`bytes ${start}-${end}/${length}`)
        ctx.set('Accept-Ranges','bytes')
        ctx.length = end - start + 1

        stream.on('error',err => ctx.onerror(err))
        ctx.body = stream
      } else {
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

// 返回所有的文件，不包含. 软链接
async function read(file,cache) {
  const stats = await fs.stat(file)

  if (stats.isDirectory()) {
    const files = await fs.readdir(file)
    await Promise.all(files.map(k => read(path.join(file,k),cache)))
  } else if (stats.isFile() && !path.basename(file).startsWith('.')) {
    cache.set(file,{ size: stats.size })
  }
  return cache
}
