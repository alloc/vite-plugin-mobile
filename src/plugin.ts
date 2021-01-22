import { resolveConfig, Plugin as VitePlugin } from 'vite'
import wantsMobile from 'wants-mobile'
import chalk from 'chalk'
import path from 'path'

interface PluginOptions {
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
   * Vite plugins only for the mobile bundle.
   *
   * Note: These plugins only run on `vite build`.
   */
  mobilePlugins?: VitePlugin[]
}

const NODE_MODULES_DIR = path.sep + 'node_modules' + path.sep

export default (opts: PluginOptions = {}): VitePlugin => {
  const roots = {
    mobile: opts.mobileRoot || '/src/mobile',
    desktop: opts.desktopRoot || '/src/desktop',
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
              const plugins = await loadMobilePlugins(mode, opts)
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

              await mobileBundle.close()
            },
          })
          return null
        }
    },
    configureServer({ middlewares }) {
      middlewares.use(async (req, _, next) => {
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

async function loadMobilePlugins(mode: string, opts: PluginOptions) {
  const config = await resolveConfig(
    { plugins: opts.mobilePlugins },
    'build',
    mode
  )
  return [...config.plugins]
}
