import type { Plugin as RollupPlugin } from 'rollup'
import { Plugin as VitePlugin, BuildConfig } from 'vite'
import wantsMobile from 'wants-mobile'
import path from 'path'

const isBuildMode = process.argv[2] == 'build'

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

  if (isBuildMode) {
    const createRedirectPlugin = (
      deviceType: 'mobile' | 'desktop',
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

    return {
      configureBuild(viteConfig, builds) {
        type ViteBuild = typeof builds[number]
        const mobileBuild: ViteBuild = {
          input: 'index.html',
          output: { file: 'index.mobile.html' },
        }

        // Add the mobile build now to respect plugin order.
        // It won't start until the main build is finished.
        builds.push(mobileBuild)

        const { pluginsPreBuild = [] } = viteConfig.rollupInputOptions
        viteConfig.rollupInputOptions.pluginsPreBuild = pluginsPreBuild

        pluginsPreBuild.push({
          name: 'vite-mobile:init',
          options(inputOptions) {
            // Inherit options from the main build.
            Object.assign(mobileBuild, {
              ...builds[0],
              ...mobileBuild,
              output: {
                ...builds[0].output,
                ...mobileBuild.output,
              },
              plugins: [
                createRedirectPlugin('mobile', viteConfig),
                ...inputOptions.plugins!.filter(
                  plugin => plugin.name !== 'vite-mobile:init'
                ),
              ],
            })

            // The main build needs to redirect mobile imports.
            inputOptions.plugins = inputOptions.plugins!.concat(
              createRedirectPlugin('desktop', viteConfig)
            )

            return null
          },
        })
      },
    }
  }

  return {
    configureServer({ app }) {
      app.use(async (ctx, next) => {
        if (!ctx.path.startsWith('/@modules/')) {
          const moduleRoot = findRoot(ctx.path)
          if (moduleRoot) {
            const deviceType = wantsMobile(ctx.headers) ? 'mobile' : 'desktop'
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
