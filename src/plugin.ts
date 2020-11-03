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
      configureBuild(ctx) {
        type ViteBuild = typeof ctx.builds[number]
        const mobileBuild: ViteBuild = {
          input: 'index.html',
          output: { file: 'index.mobile.html' },
        }

        // Add the mobile build now to respect plugin order.
        // It won't start until the main build is finished.
        ctx.build(mobileBuild)
        ctx.beforeEach((nextBuild, i) => {
          if (nextBuild == mobileBuild) {
            const task = ctx.log.start(`Building mobile bundle...`)
            mobileBuild.onResult = () => task.done()
          }

          // The main build is always first.
          if (i > 0) return

          // Inherit options from the main build.
          Object.assign(mobileBuild, {
            ...nextBuild,
            ...mobileBuild,
            output: {
              ...nextBuild.output,
              ...mobileBuild.output,
            },
            plugins: [
              createRedirectPlugin('mobile', ctx),
              ...nextBuild.plugins!,
            ],
          })

          // The main build needs to redirect mobile imports.
          nextBuild.plugins!.unshift(createRedirectPlugin('desktop', ctx))
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
