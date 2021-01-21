import { resolveConfig, Plugin as VitePlugin, UserConfig } from 'vite'
import wantsMobile from 'wants-mobile'
import chalk from 'chalk'
import path from 'path'

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
   * Mobile-only Vite configuration
   */
  mobileConfig?: UserConfig
}

const NODE_MODULES_DIR = path.sep + 'node_modules' + path.sep

export default ({
  mobileRoot = '/src/mobile',
  desktopRoot = '/src/desktop',
  mobileConfig = {},
}: Config = {}): VitePlugin => {
  const roots = {
    mobile: mobileRoot,
    desktop: desktopRoot,
  }
  const findRoot = (id: string) =>
    Object.values(roots).find(root => id.startsWith(root + '/'))

  const isMobile = !!process.env.IS_MOBILE
  const deviceType = isMobile ? 'mobile' : 'desktop'

  return {
    name: 'vite-mobile',
    enforce: 'pre',
    configResolved({ command, mode, root, logger }) {
      if (command !== 'build') return

      this.resolveId = async function (id, importer) {
        // Skip imports from node_modules.
        if (importer && importer.indexOf(NODE_MODULES_DIR) < 0) {
          // Resolve relative paths only.
          if (!/^\.\.?\//.test(id)) return null

          const resolved = await this.resolve(id, importer, {
            skipSelf: true,
          })
          if (resolved) {
            const moduleId = '/' + path.relative(root, resolved.id)
            const moduleRoot = findRoot(moduleId)
            if (moduleRoot)
              return path.join(
                root,
                moduleId.replace(moduleRoot, roots[deviceType])
              )
          }
        }
      }

      if (!isMobile)
        this.options = inputOptions => {
          inputOptions.plugins!.push({
            name: 'vite-mobile:generate',
            async generateBundle(outputOptions, bundle) {
              process.env.IS_MOBILE = '1'
              const { plugins }: any = await resolveConfig(
                mobileConfig,
                command,
                mode
              )
              process.env.IS_MOBILE = ''

              const { rollup } = require('rollup') as typeof import('rollup')

              logger.info(chalk.cyan('creating mobile bundle...'))
              const mobileBundle = await rollup({
                ...inputOptions,
                plugins,
              })

              const { output } = await mobileBundle.generate(outputOptions)
              for (const asset of output) {
                if (asset.fileName == 'index.html') {
                  asset.fileName = 'index.mobile.html'
                }
                if (!bundle[asset.fileName]) {
                  bundle[asset.fileName] = asset
                }
              }
            },
          })
          return null
        }
    },
    configureServer({ app }) {
      app.use(async (req, _, next) => {
        if (req.url && !req.url.startsWith('/@')) {
          const moduleRoot = findRoot(req.url)
          if (moduleRoot) {
            const deviceType = wantsMobile(req.headers) ? 'mobile' : 'desktop'
            if (moduleRoot !== roots[deviceType]) {
              req.url = req.url.replace(moduleRoot, roots[deviceType])
            }
          }
        }
        next()
      })
    },
  }
}
