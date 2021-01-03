import { rollup, InputOptions, Plugin as RollupPlugin } from 'rollup'
import { Plugin as VitePlugin } from 'vite'
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
}

const NODE_MODULES_DIR = path.sep + 'node_modules' + path.sep

export default ({
  mobileRoot = '/src/mobile',
  desktopRoot = '/src/desktop',
}: Config = {}): VitePlugin => {
  const roots = {
    mobile: mobileRoot,
    desktop: desktopRoot,
  }
  const findRoot = (id: string) =>
    Object.values(roots).find(root => id.startsWith(root + '/'))

  return {
    name: 'vite:mobile',
    enforce: 'post',
    configResolved(vite) {
      if (vite.command !== 'build') return

      const createRedirectPlugin = (
        deviceType: 'mobile' | 'desktop'
      ): RollupPlugin => ({
        name: 'vite:mobile:redirect',
        async resolveId(id, importer) {
          // Skip imports from node_modules.
          if (importer && importer.indexOf(NODE_MODULES_DIR) < 0) {
            // Resolve relative paths only.
            if (!/^\.\.?\//.test(id)) return null

            const resolved = await this.resolve(id, importer, {
              skipSelf: true,
            })
            if (resolved) {
              const moduleId = '/' + path.relative(vite.root, resolved.id)
              const moduleRoot = findRoot(moduleId)
              if (moduleRoot)
                return path.join(
                  vite.root,
                  moduleId.replace(moduleRoot, roots[deviceType])
                )
            }
          }
          return null
        },
      })

      let inputOptions: InputOptions
      this.options = (opts: InputOptions) => {
        // Reuse these options for the mobile build.
        inputOptions = {
          ...opts,
          plugins: [
            createRedirectPlugin('mobile'),
            ...opts.plugins!.filter(plugin => plugin.name !== 'vite:mobile'),
          ],
        }

        // The main build needs to redirect mobile imports.
        opts.plugins!.unshift(createRedirectPlugin('desktop'))
        return null
      }

      this.generateBundle = async function (outputOptions: any, bundle) {
        vite.logger.info(chalk.cyan('creating mobile bundle...'))
        const mobileBundle = await rollup(inputOptions)
        const { output } = await mobileBundle.generate(outputOptions)

        for (const asset of output) {
          if (asset.fileName == 'index.html') {
            asset.fileName = 'index.mobile.html'
          }
          if (!bundle[asset.fileName]) {
            bundle[asset.fileName] = asset
          }
        }
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
