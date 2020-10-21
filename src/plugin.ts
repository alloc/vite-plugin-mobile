import type {
  rollup as Rollup,
  Plugin as RollupPlugin,
  InputOptions,
} from 'rollup'
import { Plugin as VitePlugin, BuildConfig } from 'vite'
import DeviceDetector from 'device-detector-js'
import path from 'path'

const isBuild = process.argv[2] == 'build'

type Config = {
  /**
   * The directory containing phone-only modules.
   * @default "/src/mobile"
   */
  mobileRoot?: string
  /**
   * The directory containing desktop-only modules.
   * @default "/src/desktop"
   */
  desktopRoot?: string
  /**
   * The directory containing tablet-only modules.
   * @default this.mobileRoot
   */
  tabletRoot?: string
}

const NODE_MODULES_DIR = path.sep + 'node_modules' + path.sep

export default ({
  mobileRoot = '/src/mobile',
  desktopRoot = '/src/desktop',
  tabletRoot = mobileRoot,
}: Config = {}): VitePlugin => {
  const roots = {
    mobile: mobileRoot,
    desktop: desktopRoot,
    tablet: tabletRoot,
  }
  const uniqueRoots = uniq(roots)
  const findRoot = (id: string) =>
    uniqueRoots.find(root => id.startsWith(root + '/'))

  if (isBuild) {
    const createResolverPlugin = (
      deviceType: 'mobile' | 'tablet',
      config: Readonly<BuildConfig>
    ): RollupPlugin => ({
      name: 'vite-mobile:resolver',
      async resolveId(id, importer) {
        // Skip imports from node_modules.
        if (importer && importer.indexOf(NODE_MODULES_DIR) < 0) {
          // Resolve relative paths only.
          if (!/^\.\.?\//.test(id)) return null

          const resolved = await this.resolve(id, importer, {
            skipSelf: true,
          })
          if (resolved) {
            const moduleId = '/' + path.relative(config.root, resolved.id)
            const moduleRoot = findRoot(moduleId)
            if (moduleRoot)
              return path.join(
                config.root,
                moduleId.replace(moduleRoot, roots[deviceType])
              )
          }
        }
        return null
      },
    })

    const rollup = require('rollup').rollup as typeof Rollup
    return {
      configureBuild(config, builds) {
        const { plugins = [] } = config.rollupInputOptions
        config.rollupInputOptions.plugins = plugins

        const createBuild = (
          deviceType: 'mobile' | 'tablet',
          inputOptions: Readonly<InputOptions>
        ) => ({
          // Emit "index.mobile.html" or "index.tablet.html"
          id: 'index.' + deviceType,
          // Wait until preceding bundles are finished.
          get bundle() {
            return rollup({
              ...inputOptions,
              plugins: [
                createResolverPlugin(deviceType, config),
                ...inputOptions.plugins!.filter(
                  plugin => plugin.name !== 'vite-mobile:init'
                ),
              ],
            })
          },
        })

        // The mobile/tablet builds need the same options used by
        // the desktop build, so we must wait for them.
        plugins.push({
          name: 'vite-mobile:init',
          options(inputOptions) {
            builds.push(createBuild('mobile', inputOptions))
            if (uniqueRoots.length > 2)
              builds.push(createBuild('tablet', inputOptions))

            return null
          },
        })
      },
    }
  }

  return {
    configureServer({ app }) {
      const parser = new DeviceDetector({ skipBotDetection: true })
      app.use(async (ctx, next) => {
        if (!ctx.path.startsWith('/@modules/')) {
          const moduleRoot = findRoot(ctx.path)
          if (moduleRoot) {
            const { device } = parser.parse(ctx.get('User-Agent'))
            const deviceType =
              (device &&
                ((/tablet/.test(device.type) && 'tablet') ||
                  (/phone/.test(device.type) && 'mobile'))) ||
              'desktop'

            if (moduleRoot !== roots[deviceType]) {
              ctx.path = ctx.path.replace(moduleRoot, roots[deviceType])
            }
          }
        }
        await next()
      })
    },
  }
}

function uniq<T>(values: { [key: string]: T }) {
  return Array.from(new Set(Object.values(values)))
}
