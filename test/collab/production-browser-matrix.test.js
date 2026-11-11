/** C15入口：LARK_PRODUCTION_MATRIX=1启用真实执行；默认仅E1工具单测，不声称浏览器通过。
 * 可选LARK_PRODUCTION_MATRIX_CONFIG指向JSON：frontendSourceHash/mainEntrySha256、backendEvidencePath、
 * perfResultPath/perfSourceHash/perfElementSha256、esmSourceHash/esmEntrySha256、nativeReports[]、previousReports[]、outputDirectory。
 * probesOnly可显式选择原cell id或cold-mention/cold-calendar/cold-calendar-cancelled/cold-block-handle/native-esm-providers；默认全跑，未选项BLOCKED。
 * Safari/真机触控只导入同制品真实原生driver报告；缺者BLOCKED，不拿WebKit/模拟器替代。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { AC_IDS, MATRIX, artifact, compareBudgets, createEvidence, preserveReport, sha256, sourceFiles, validateEvidence } from '../../scripts/production-evidence.mjs'
import { findChromium, loadChromiumDriver, prepareHostPage, REPO_ROOT, serveStatic, waitForHostReady } from '../../scripts/perf/browser.mjs'
import { buildDocBlocks, buildDocHtml } from '../../scripts/perf/build-doc.mjs'

describe('C15 matrix工具契约（E1，不是功能验收）', () => {
  it('保留3类真实浏览器/设备×2个原生DOM宿主入口×3态，不减少2000块样本', () => {
    expect(MATRIX).toHaveLength(18)
    expect(new Set(MATRIX.map(cell => cell.id)).size).toBe(18)
    // 原样本的2000次逻辑迭代含标题+子段落，不能截成2000个物理片段来缩工作负载。
    const parts = buildDocBlocks({ seed: 42, blocks: 2000 })
    expect(parts).toHaveLength(2477)
    expect(parts.join('')).toBe(buildDocHtml({ seed: 42, blocks: 2000 }))
    expect(sha256(parts.join(''))).toBe('sha256:ddf5516f824f48f19759da79b43adf352d234ba8c7934f1cb1120a3459bb4abd')
    expect(AC_IDS).toHaveLength(7)
  })
})

if (process.env.LARK_PRODUCTION_MATRIX === '1') describe('C15实际制品矩阵（缺依赖必须BLOCKED）', () => {
  it('执行当前可用真实矩阵并保留原始结果，禁止把未运行项算通过', async () => {
    const config = process.env.LARK_PRODUCTION_MATRIX_CONFIG ? JSON.parse(fs.readFileSync(process.env.LARK_PRODUCTION_MATRIX_CONFIG, 'utf8')) : {}
    const coldProbes = ['mention', 'calendar', 'calendar-cancelled', 'block-handle']
    const probesOnly = config.probesOnly === undefined ? null : config.probesOnly
    const availableProbes = [...MATRIX.filter(cell => cell.browser === 'chromium').map(cell => cell.id), ...coldProbes.map(name => 'cold-' + name), 'native-esm-providers']
    const backend = path.resolve(REPO_ROOT, '../lark-doc-backend')
    const report = createEvidence({ backend })
    const inputFiles = [
      ...[REPO_ROOT, backend].flatMap(root => sourceFiles(root).map(file => path.join(root, file))),
      ...fs.readdirSync(path.join(REPO_ROOT, 'scripts/perf')).filter(file => file.endsWith('.mjs')).map(file => path.join(REPO_ROOT, 'scripts/perf', file)),
      path.join(REPO_ROOT, 'scripts/production-evidence.mjs'), path.join(REPO_ROOT, 'test/collab/production-browser-matrix.test.js'), path.join(backend, 'test/evidence/schema.json'),
    ]
    const inputSha256 = Object.fromEntries(inputFiles.map(file => [file, sha256(fs.readFileSync(file))]))
    const directory = config.outputDirectory ? fs.mkdtempSync(path.join(config.outputDirectory, 'us15-')) : fs.mkdtempSync(path.join(os.tmpdir(), 'larkdoc-production-matrix-'))
    fs.chmodSync(directory, 0o700)
    const started = report.startedAt
    const step = (id, name, status, executionType, observed, acIds = [], command = [], limitations = []) => {
      const now = new Date().toISOString()
      const raw = path.join(directory, id.replace(/[^a-z0-9.-]/gi, '-') + '.json')
      fs.writeFileSync(raw, JSON.stringify({ id, status, observed, limitations }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
      const item = artifact(raw, 'raw-report', id + '-raw'); report.artifacts.push(item)
      report.steps.push({ id, name, status, executionType, startedAt: started, endedAt: now, command, acIds, rawArtifactIds: [item.id], observed, limitations })
      if (status === 'BLOCKED') report.blockedReasons.push(`${id}: ${limitations.join('；') || name}`)
    }
    let browser, server
    let backendCoverage = [], coveredStories = []
    const host = path.join(directory, 'host')
    try {
      if (probesOnly !== null && (!Array.isArray(probesOnly) || !probesOnly.length || probesOnly.length > availableProbes.length ||
        new Set(probesOnly).size !== probesOnly.length || probesOnly.some(id => !availableProbes.includes(id)))) throw new Error('INVALID_PROBES_ONLY')
      if (probesOnly !== null) report.limitations.push('仅执行显式probesOnly：' + probesOnly.join(',') + '；未选原矩阵及探针保持BLOCKED，不减少默认原2000块或宣称全矩阵通过。')
      const elementFile = path.join(REPO_ROOT, 'dist/lark-doc-element.umd.min.js')
      const baselineFile = path.join(REPO_ROOT, 'perf/baseline.json')
      const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'))
      report.artifacts.push(artifact(baselineFile, 'baseline', 'original-performance-baseline'))
      let bundle
      if (fs.existsSync(elementFile)) {
        bundle = fs.readFileSync(elementFile)
        const attested = config.frontendSourceHash === report.revisions.frontend.sourceHash
        report.artifacts.push(artifact(elementFile, attested ? 'frontend' : 'fixture', 'element-actual-bundle', attested ? config.frontendSourceHash : undefined))
        step('artifact-binding', 'Element实际字节与当前源指纹', attested ? 'PASS' : 'BLOCKED', 'static', { bundleHash: sha256(bundle), sourceHash: report.revisions.frontend.sourceHash }, ['AC-15-S'], [], attested ? [] : ['未供给构建时源指纹，不能声明预构建产物来自当前dirty源树'])
      } else step('artifact-binding', '缺实际Element制品', 'BLOCKED', 'not-executed', null, ['AC-15-S'], ['npm', 'run', 'build:element'], ['此旧checkout保留Vue2/Webpack；本入口不自动重建或替换工具链'])
      const rollupCheck = path.join(REPO_ROOT, 'scripts/check-rollup-artifacts.mjs')
      if (!fs.existsSync(rollupCheck)) step('toolchain-inventory', '当前Webpack入口盘点', 'PASS', 'static', { rollupScriptAvailable: false, rollupExecuted: false, currentChecker: 'scripts/ensure-artifacts.mjs --check' }, ['AC-15-S'], [], ['没有运行不存在的Rollup脚本；实际制品仍须通过本checkout原Webpack检查器'])
      else {
        try { const output = execFileSync(process.execPath, [rollupCheck], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 60000 }); step('rollup-check', '现有制品检查', 'PASS', 'static', { output }, ['AC-15-S'], [process.execPath, rollupCheck]) }
        catch (error) { step('rollup-check', '现有制品检查', 'FAIL', 'static', { error: error.message }, ['AC-15-S']) }
      }
      if (config.runArtifactChecks && config.buildNode) {
        try {
          const node = execFileSync(config.buildNode, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim()
          if (!/^v14\./.test(node)) throw new Error('需现项目固定Node14构建检查器')
          const npm = path.resolve(config.buildNode, '../../lib/node_modules/npm/bin/npm-cli.js')
          const command = [npm, 'run', 'artifacts:check']
          const output = execFileSync(config.buildNode, command, { cwd: REPO_ROOT, env: { ...process.env, PATH: path.dirname(config.buildNode) + path.delimiter + process.env.PATH }, encoding: 'utf8', timeout: 60000 })
          step('actual-artifact-check', '原Webpack制品检查器', 'PASS', 'static', { node, output }, ['AC-15-S'], [config.buildNode, ...command])
        } catch (error) { step('actual-artifact-check', '原Webpack制品检查器', 'FAIL', 'static', { error: error.message }, ['AC-15-S']) }
      } else step('actual-artifact-check', '原Webpack制品检查器尚未执行', 'BLOCKED', 'not-executed', null, ['AC-15-S'], ['Node14', 'scripts/ensure-artifacts.mjs', '--check'], ['启用runArtifactChecks并提供buildNode；不替换构建工具链'])

      let measured = null
      if (config.perfResultPath && config.perfSourceHash === report.revisions.frontend.sourceHash && bundle && config.perfElementSha256 === sha256(bundle)) {
        measured = JSON.parse(fs.readFileSync(config.perfResultPath, 'utf8'))
        report.artifacts.push(artifact(config.perfResultPath, 'performance', 'existing-perf-result'))
        if (!measured.samples || measured.samples.keystroke !== 30 || measured.samples.decorations !== 20 || measured.samples.save !== 10) measured = null
      }
      report.budgets = compareBudgets(bundle, baseline, measured, report.environment)
      step('size-budget', 'Element原gzip≤475000 B预算', report.budgets.size.status, 'static', report.budgets.size, ['AC-15-S'])
      step('performance-budget', '原2000块/固定样本/>20%性能门禁', report.budgets.performance.status, measured ? 'real-browser' : 'not-executed', report.budgets.performance, ['AC-15-S', 'AC-15-C'],
        ['node', 'scripts/perf/measure.mjs', 'then', 'node', 'scripts/perf/report.mjs'], measured ? [] : ['需先运行原scripts/perf采集/报告并提供同源同制品指纹；不更新baseline，不填虚构SLO'])

      if (config.backendEvidencePath) {
        const raw = JSON.parse(fs.readFileSync(config.backendEvidencePath, 'utf8'))
        report.artifacts.push(artifact(config.backendEvidencePath, 'raw-report', 'backend-existing-cli-evidence'))
        // local-closure.mjs直接传入独立Webpack配置，不读取Vue CLI的压缩配置。
        // 该配置仍由上面的实际Element制品绑定与预算检查验证。
        const excludedBuildInput = '../lark-doc/vue.config.js'
        const expected = [...new Set([...Object.keys(raw.inputSha256 || {}), ...sourceFiles(backend), ...sourceFiles(REPO_ROOT).map(file => '../lark-doc/' + file)])].filter(file => file !== excludedBuildInput)
        const mismatch = expected.filter(file => !raw.inputSha256 || raw.inputSha256[file] !== sha256(fs.readFileSync(path.resolve(backend, file))).slice(7))
        const reuse = { executedThisRun: 0, reused: raw.tests?.length || 0, excludedBuildInput,
          originalSha256: raw.inputSha256?.[excludedBuildInput], currentSha256: sha256(fs.readFileSync(path.resolve(backend, excludedBuildInput))),
          reason: 'local-closure.mjs的独立inline Webpack配置不读取Vue CLI配置；其他原输入全部逐字节验证' }
        const closed = raw.normallyStopped === true || raw.cleanup && raw.cleanup.postgres === 'normally closed'
        const passed = raw.passed === true && closed && mismatch.length === 0
        report.environment.database = passed ? 'isolated-postgresql' : 'none'
        report.claims.durableBackend = passed
        if (passed) { backendCoverage = raw.coveredAcIds || []; coveredStories = raw.coveredStories || [] }
        report.identities.push({ alias: 'local-dual-user-fixture', tenantAlias: 'local-tenants', kind: 'synthetic-local', roles: ['writer', 'reader', 'denied'], credentialsIncluded: false })
        step('backend-closure', '复用现有真实本机CLI证据', passed ? 'PASS' : 'BLOCKED', 'real-database', { passed: raw.passed === true, normallyClosed: Boolean(closed), mismatchedInputs: mismatch, coveredAcIds: raw.coveredAcIds || [], reuse },
          ['AC-15-A', 'AC-15-C', 'AC-15-D', 'AC-15-Q'], [process.execPath, path.join(backend, 'test/local-closure.mjs')], passed ? ['合成IdP/身份供给，不是公司真实账号或生产验收'] : ['旧证据保留不补写；需当前全部src/ops及前端输入hash与正常关闭事实'])
      } else step('backend-closure', '未供给现有CLI真实证据', 'BLOCKED', 'not-executed', null,
        ['AC-15-A', 'AC-15-C', 'AC-15-D', 'AC-15-Q'], [process.execPath, path.join(backend, 'test/local-closure.mjs')], ['由既有runner正常创建/关闭独占PG后传入其evidence路径；本工具不复制PG编排或用mock替代'])

      if (bundle) {
        prepareHostPage(host)
        // A public main-UMD host must be a separate realm from the Element bundle.
        expect(JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'node_modules/vue/package.json'), 'utf8')).version).toBe('2.7.14')
        const mainFiles = fs.readdirSync(path.join(REPO_ROOT, 'dist')).filter(file => file.startsWith('lark-doc.umd.min.') && file.endsWith('.js'))
        expect(mainFiles).toContain('lark-doc.umd.min.js')
        const mainSources = Object.fromEntries([...mainFiles.map(file => [file, path.join(REPO_ROOT, 'dist', file)]),
          ['lark-doc.css', path.join(REPO_ROOT, 'dist/lark-doc.css')],
          ['vue.runtime.min.js', path.join(REPO_ROOT, 'node_modules/vue/dist/vue.runtime.min.js')]])
        const mainBefore = Object.fromEntries(Object.entries(mainSources).map(([file, source]) => [file, sha256(fs.readFileSync(source))]))
        for (const source of Object.values(mainSources)) { inputFiles.push(source); inputSha256[source] = sha256(fs.readFileSync(source)) }
        const mainAttested = config.frontendSourceHash === report.revisions.frontend.sourceHash && config.mainEntrySha256 === mainBefore['lark-doc.umd.min.js'] && report.steps.some(item => item.id === 'actual-artifact-check' && item.status === 'PASS')
        step('main-artifact-binding', '主UMD声明源/预期SHA与构建时效核对', mainAttested ? 'PASS' : 'BLOCKED', 'static', { mainUmdSha256: mainBefore['lark-doc.umd.min.js'], expectedMainSha256: config.mainEntrySha256 || null, provenance: 'caller supplies source revision and expected artifact SHA; existing stamp checks freshness/size, not a signed build origin', sourceHash: report.revisions.frontend.sourceHash, peerVersion: '2.7.14', peerSha256: mainBefore['vue.runtime.min.js'] }, ['AC-15-S'], [], mainAttested ? [] : ['需声明当前源及独立预期mainEntrySha256、原Node14/npm8七入口stamp时效检查通过；stamp本身不证明密码学构建来源；Vue为锁定peer'])
        for (const [file, source] of Object.entries(mainSources)) {
          fs.copyFileSync(source, path.join(host, file))
          report.artifacts.push(artifact(path.join(host, file), file !== 'vue.runtime.min.js' && mainAttested ? 'frontend' : 'fixture', 'main-host-' + file, file !== 'vue.runtime.min.js' && mainAttested ? report.revisions.frontend.sourceHash : undefined))
        }
        if (fs.existsSync(path.join(REPO_ROOT, 'dist/fonts'))) fs.cpSync(path.join(REPO_ROOT, 'dist/fonts'), path.join(host, 'fonts'), { recursive: true })
        fs.writeFileSync(path.join(host, 'facade.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="./lark-doc.css"></head><body><div id="facade" style="width:960px;height:860px;margin:12px auto"></div><script src="./vue.runtime.min.js"></script><script src="./lark-doc.umd.min.js"></script><script>window.__larkDoc=new window["lark-doc"].LarkDoc({element:document.getElementById("facade"),storage:"none"})</script></body></html>')
        report.artifacts.push(artifact(path.join(host, 'facade.html'), 'fixture', 'public-main-umd-host'))
        const served = await serveStatic(host); server = served.server
        const staticRequest = server.listeners('request')[0]
        server.removeListener('request', staticRequest)
        server.on('request', (req, res) => {
          const setHeader = res.setHeader.bind(res)
          res.setHeader = (key, value) => setHeader(key, key.toLowerCase() === 'content-type' && req.url.split('?')[0].endsWith('.css') ? 'text/css; charset=utf-8' : value)
          staticRequest(req, res)
        })
        const executablePath = findChromium()
        if (!executablePath) throw new Error('CHROMIUM_UNAVAILABLE')
        browser = await loadChromiumDriver().launch({ executablePath, headless: true })
        for (const cell of MATRIX.filter(item => item.browser === 'chromium' && (probesOnly === null || probesOnly.includes(item.id)))) {
          const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
          const pageErrors = [], requestFailures = []
          page.on('pageerror', error => pageErrors.push(error.message))
          page.on('requestfailed', request => requestFailures.push(request.url()))
          let releasePanels, panelsRequested = false, releaseHelp, helpRequested = false
          try {
            const coldPanels = cell.entry === 'element' && cell.mode === 'edit'
            const coldHelp = cell.mode === 'edit'
            if (coldHelp) {
              const held = new Promise(resolve => { releaseHelp = resolve })
              await page.route(/\.editor-help\.js$/, async route => { helpRequested = true; await held; await route.continue() })
            }
            if (coldPanels) {
              const held = new Promise(resolve => { releasePanels = resolve })
              await page.route(/\.editor-panels\.js$/, async route => { panelsRequested = true; await held; await route.continue() })
            }
            await page.goto(`http://127.0.0.1:${served.port}${cell.entry === 'facade' ? '/facade.html' : '/'}`, { waitUntil: 'domcontentloaded' })
            let timer
            try { await Promise.race([waitForHostReady(page), new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('HOST_READY_TIMEOUT')), 15000) })]) }
            finally { clearTimeout(timer) }
            if (cell.entry === 'element') expect(await page.evaluate(() => Object.keys(window['lark-doc-element']).sort())).toEqual([
              'DEFAULT_TAG', 'LarkDoc', 'LarkDocElement', 'createLarkDocElement', 'loadCollaboration', 'default', 'isRegistered', 'mountLarkDoc', 'registerLarkDoc', 'upgradeLarkDoc',
            ].sort())
            const before = await page.evaluate(async ({ entry, mode, html }) => {
              const app = entry === 'element' ? window.__larkDoc.document : window.__larkDoc
              if (entry === 'facade' && (window['lark-doc-element'] || app.constructor !== window['lark-doc'].LarkDoc)) throw new Error('NOT_PUBLIC_MAIN_UMD')
              const deadline = Date.now() + 15000
              while (!app.getEditor()) { if (Date.now() > deadline) throw new Error('MOUNT_TIMEOUT'); await new Promise(resolve => setTimeout(resolve, 20)) }
              const contentStarted = performance.now()
              app.setContent(html)
              const setContentMs = performance.now() - contentStarted
              const view = app.getWorkspace().$refs.document
              view.setMode(mode)
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              window.__matrixApp = app
              const editor = app.getEditor(); app.focus()
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const source = document.createElement('div'); source.innerHTML = html
              const last = editor.state.doc.lastChild
              window.__matrixReadBaseline = mode === 'read' ? JSON.stringify(editor.getJSON()) : null
              return { blocks: editor.state.doc.childCount, mode: view.interactionMode, editable: editor.isEditable,
                focused: editor.view.dom.contains(document.activeElement), textLength: editor.getText().length, userAgent: navigator.userAgent, setContentMs,
                textPreserved: source.textContent === editor.state.doc.textContent,
                emptyTrailingParagraph: last.type.name === 'paragraph' && last.content.size === 0 && last.textContent === '' }
            }, { entry: cell.entry, mode: cell.mode, html: buildDocHtml({ seed: 42, blocks: 2000 }) })
            expect(before.blocks).toBe(buildDocBlocks({ seed: 42, blocks: 2000 }).length + (before.emptyTrailingParagraph ? 1 : 0))
            expect(before.textPreserved).toBe(true)
            step(cell.id + '-content', '公开setContent完整装载原2000逻辑块', 'PASS', 'real-browser', { entry: cell.entry, mode: cell.mode, originalBlocks: 2477, physicalBlocks: before.blocks, emptyTrailingParagraph: before.emptyTrailingParagraph, exactTextPreserved: before.textPreserved, setContentMs: before.setContentMs }, ['AC-15-S'])
            const typingStarted = Date.now()
            if (cell.mode !== 'read') await page.waitForFunction(() => window.__matrixApp.getEditor().view.dom.contains(document.activeElement))
            // 模式探针走真实浏览器文本input；逐事务30样本性能仍由原perf采集。
            await page.keyboard.insertText('matrix-probe')
            const typingElapsedMs = Date.now() - typingStarted
            if (cell.mode !== 'read') expect(await page.evaluate(() => window.__matrixApp.getEditor().getText().includes('matrix-probe'))).toBe(true)
            if (coldPanels) {
              await page.evaluate(() => window.__matrixApp.getWorkspace().$refs.document.openSearch('find'))
              expect(panelsRequested).toBe(true)
              expect(await page.locator('[aria-label="查找内容"]').count()).toBe(0)
              releasePanels()
              await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '查找内容')
              await page.locator('[aria-label="查找内容"]').fill('matrix-probe')
              await page.locator('[aria-label="关闭查找"]').click()
              const original = await page.evaluate(() => {
                const ed = window.__matrixApp.getWorkspace().$refs.document
                const json = JSON.stringify(ed.editor.getJSON()); ed.startIsvButton('open_link'); return json
              })
              await page.locator('[aria-label="按钮文字"]').fill('cold-panel-probe')
              expect(await page.evaluate(() => window.__matrixApp.getWorkspace().$refs.document.isvButtonText)).toBe('cold-panel-probe')
              await page.keyboard.press('Escape')
              expect(await page.locator('[role="dialog"][aria-label="按钮配置"]').count()).toBe(0)
              expect(await page.evaluate(() => JSON.stringify(window.__matrixApp.getEditor().getJSON()))).toBe(original)
              step('cold-async-panels', '真实延迟chunk后查找聚焦、输入与ISV取消不改正文', 'PASS', 'real-browser', { panelsRequested, searchFocused: true, isvCancelled: true }, ['AC-15-S'])
              await page.evaluate(() => window.__matrixApp.getWorkspace().$refs.document.openExportDialog('markdown'))
              await page.waitForSelector('.lark-doc-export-backdrop')
              await page.evaluate(() => {
                const ed = window.__matrixApp.getWorkspace().$refs.document, originalDispatch = ed.dispatchExport
                ed.dispatchExport = () => new Promise(resolve => { window.__finishMatrixExport = resolve })
                window.__matrixExport = ed.submitExport().finally(() => { ed.dispatchExport = originalDispatch })
              })
              await page.waitForSelector('.lark-doc-export-toast')
              expect(await page.locator('.lark-doc-export-backdrop').count()).toBe(0)
              await page.evaluate(async () => { window.__finishMatrixExport(); await window.__matrixExport })
              await page.waitForSelector('.lark-doc-export-toast', { state: 'detached' })
              step('async-overlay-toast', '真实DOM弹窗关闭后保留处理中toast，完成后消失', 'PASS', 'injected-port', { dialogClosedBeforeCompletion: true, toastSurvived: true }, ['AC-15-S'], [], ['仅导出派发端口注入暂停；不是实际文件或对象服务成功证据'])
              await page.evaluate(() => { window.__matrixApp.getWorkspace().$refs.document.outlineOpen = true })
              await page.locator('.lark-doc-outline-item > button:last-child').first().click()
              expect(await page.evaluate(() => {
                const ed = window.__matrixApp.getWorkspace().$refs.document
                return ed.editor.state.selection.from === ed.outlineItems[0].pos + 1
              })).toBe(true)
              await page.evaluate(() => { window.__matrixApp.focus() })
              await page.waitForFunction(() => window.__matrixApp.getEditor().isFocused)
              await page.evaluate(() => window.__matrixApp.getEditor().commands.setTextSelection({ from: 1, to: 4 }))
              await page.waitForSelector('[role="toolbar"][aria-label="划词工具栏"]')
              const color = await page.evaluate(() => window.__matrixApp.getWorkspace().$refs.document.textColorOptions[1])
              await page.locator('.lark-doc-color[title="颜色"]').click()
              await page.locator(`[aria-label="字体颜色 ${color.label}"]`).click()
              expect(await page.evaluate(() => window.__matrixApp.getEditor().getAttributes('textStyle').color)).toBe(color.value)
              const colored = await page.evaluate(() => JSON.stringify(window.__matrixApp.getEditor().getJSON()))
              await page.locator('.lark-doc-color[title="颜色"]').click()
              await page.waitForSelector('.lark-doc-color-palette')
              await page.keyboard.press('Escape')
              expect(await page.evaluate(() => JSON.stringify(window.__matrixApp.getEditor().getJSON()))).toBe(colored)
              const cell = page.locator('.ProseMirror table th,.ProseMirror table td').first()
              await cell.click()
              await page.waitForSelector('[role="toolbar"][aria-label="表格工具"]')
              const rect = await cell.boundingBox(); expect(rect).toBeTruthy()
              await page.mouse.move(rect.x + 1, rect.y + rect.height / 2)
              await page.waitForSelector('[role="toolbar"][aria-label="表格边界操作"]')
              const boundaryStyle = await page.evaluate(() => {
                const ed = window.__matrixApp.getWorkspace().$refs.document, tools = document.querySelector('.lark-doc-table-boundary-tools')
                return ['left', 'top', 'width', 'height'].map(key => ({ key, actual: tools.style[key], expected: ed.tableBoundary.style[key],
                  actualNumber: parseFloat(tools.style[key]), expectedNumber: parseFloat(ed.tableBoundary.style[key]) }))
              })
              const boundaryBound = boundaryStyle.every(item => Number.isFinite(item.actualNumber) && Number.isFinite(item.expectedNumber) && Math.abs(item.actualNumber - item.expectedNumber) <= 0.01)
              step('table-boundary-style', '表格边界四项真实CSSOM绑定保留小数px语义', boundaryBound ? 'PASS' : 'FAIL', 'real-browser', { boundaryStyle, tolerancePx: 0.01 }, ['AC-15-S'])
              expect(boundaryBound).toBe(true)
              const columns = await cell.evaluate(element => element.parentElement.children.length)
              await page.locator('[aria-label="在左侧插入列"]').click()
              expect(await cell.evaluate(element => element.parentElement.children.length)).toBe(columns + 1)
              await page.evaluate(() => {
                const editor = window.__matrixApp.getEditor()
                editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'callout', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'callout-ui-probe' }] }] })
                let target
                editor.state.doc.descendants((node, pos) => { if (node.type.name === 'callout' && node.textContent === 'callout-ui-probe') target = pos + 2 })
                editor.chain().setTextSelection(target).focus().run()
              })
              await page.locator('.ProseMirror [data-type="callout"]').last().scrollIntoViewIfNeeded()
              await page.waitForSelector('[aria-label="高亮块工具"]')
              await page.locator('label[title="高亮块文字颜色"]').click()
              expect(await page.evaluate(() => window.__matrixApp.getWorkspace().$refs.document.colorPaletteOpen)).toBe('calloutColor')
              const calloutColor = await page.evaluate(() => window.__matrixApp.getWorkspace().$refs.document.colorPaletteOptions.find(color => color.value))
              await page.locator(`.lark-doc-color-palette [aria-label="${calloutColor.label}"]`).click()
              expect(await page.evaluate(() => window.__matrixApp.getEditor().getAttributes('callout').color)).toBe(calloutColor.value)
              const calloutJSON = await page.evaluate(() => JSON.stringify(window.__matrixApp.getEditor().getJSON()))
              await page.locator('[aria-label="更换高亮块图标"]').click()
              await page.waitForSelector('[role="menu"][aria-label="高亮块图标"]')
              expect(await page.evaluate(() => ['above', 'below'].includes(window.__matrixApp.getWorkspace().$refs.document.calloutEmojiPlacement))).toBe(true)
              await page.locator('[aria-label="搜索高亮块图标"]').fill('smile')
              await page.keyboard.press('Escape')
              expect(await page.locator('[role="menu"][aria-label="高亮块图标"]').count()).toBe(0)
              expect(await page.evaluate(() => JSON.stringify(window.__matrixApp.getEditor().getJSON()))).toBe(calloutJSON)
              step('async-structural-panels', '真实目录跳转、划词条、选色、表格悬停几何及插列', 'PASS', 'real-browser', { outlineTargetMatched: true, bubbleVisible: true, colorApplied: true, colorCancelUnchanged: true, tableGeometryMatched: true, columnAdded: true }, ['AC-15-S'])
              step('callout-controls', '高亮块文字选色、图标弹层定位与取消保正文', 'PASS', 'real-browser', { colorTargetMatched: true, actualColorApplied: true, emojiPopoverPositioned: true, cancelledWithoutBodyChange: true }, ['AC-15-S'])
            }
            if (cell.mode === 'suggest') {
              await page.waitForSelector('.lark-doc-revision-panel[role="dialog"]')
              expect(await page.locator('.lark-doc-revision-panel').filter({ hasText: 'matrix-probe' }).count()).toBeGreaterThan(0)
              expect(await page.evaluate(() => window.__matrixApp.getEditor().view.dom.contains(document.activeElement))).toBe(true)
            }
            if (coldHelp) {
              await page.evaluate(() => { window.__matrixApp.getWorkspace().$refs.document.helpOpen = true })
              expect(helpRequested).toBe(true)
              expect(await page.locator('[aria-label="关闭快捷键帮助"]').count()).toBe(0)
              const cancelled = cell.entry === 'facade'
              if (cancelled) await page.evaluate(() => { window.__matrixApp.getWorkspace().$refs.document.helpOpen = false; window.__matrixApp.focus() })
              releaseHelp()
              await page.waitForSelector('.lark-doc-help-fab')
              if (cancelled) {
                await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
                expect(await page.evaluate(() => window.__matrixApp.getEditor().view.dom.contains(document.activeElement))).toBe(true)
                expect(await page.locator('[aria-label="关闭快捷键帮助"]').count()).toBe(0)
              } else {
                await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '关闭快捷键帮助')
                await page.keyboard.press('Escape')
                expect(await page.locator('[aria-label="关闭快捷键帮助"]').count()).toBe(0)
              }
              step('cold-help-' + cell.entry, '帮助冷加载后的焦点与关闭期间不抢焦点', 'PASS', 'real-browser', { helpRequested, cancelledBeforeLoad: cancelled, focusPreserved: true }, ['AC-15-S'])
            }
            const after = await page.evaluate(() => {
              const app = window.__matrixApp, editor = app.getEditor()
              const textLength = editor.getText().length
              const readUnchanged = !window.__matrixReadBaseline || JSON.stringify(editor.getJSON()) === window.__matrixReadBaseline
              app.destroy(); app.destroy()
              return { textLength, destroyed: editor.isDestroyed, remainingEditors: document.querySelectorAll('.ProseMirror').length,
                readUnchanged }
            })
            expect(before.mode).toBe(cell.mode)
            expect(before.editable).toBe(cell.mode !== 'read')
            if (cell.mode !== 'read') expect(before.focused).toBe(true)
            else { expect(after.textLength).toBe(before.textLength); expect(after.readUnchanged).toBe(true) }
            expect(after.destroyed).toBe(true); expect(after.remainingEditors).toBe(0)
            expect(pageErrors).toEqual([]); expect(requestFailures).toEqual([])
            const actualBrowser = { name: 'Chromium', version: browser.version(), engine: 'Blink', automation: 'playwright-chromium', native: true, userAgent: before.userAgent }
            report.environment.browser = actualBrowser; report.environment.device = 'desktop'
            step(cell.id, '原生DOM宿主/三态/焦点/销毁/原2000逻辑块样本', 'PASS', 'real-browser', { matrixCell: cell.id, entry: cell.entry, entrySource: cell.entry === 'facade' ? 'public-main-umd-LarkDoc' : 'actual-custom-element', ...(cell.entry === 'facade' ? { mainUmdSha256: mainBefore['lark-doc.umd.min.js'], vuePeerSha256: mainBefore['vue.runtime.min.js'] } : {}), mode: cell.mode, browser: actualBrowser, logicalBlocks: 2000, physicalBlocks: before.blocks, editable: before.editable, focused: before.focused, destroyed: after.destroyed, setContentMs: before.setContentMs, inputMethod: 'keyboard.insertText', inputElapsedMs: typingElapsedMs }, ['AC-15-S', 'AC-15-Q'])
          } catch (error) { step(cell.id, '当前真实浏览器矩阵单元', 'FAIL', 'real-browser', { matrixCell: cell.id, error: error.message, stack: error.stack || null }, ['AC-15-S', 'AC-15-Q']) }
          finally { if (releasePanels) releasePanels(); if (releaseHelp) releaseHelp(); await page.close() }
        }
        expect(Object.entries(mainSources).every(([file, source]) => sha256(fs.readFileSync(source)) === mainBefore[file] && sha256(fs.readFileSync(path.join(host, file))) === mainBefore[file])).toBe(true)
        // 独立最小几何样本不作吞吐证明；原六cell和2000逻辑块性能样本不变。
        for (const probe of coldProbes) {
          if (probesOnly !== null && !probesOnly.includes('cold-' + probe)) {
            step('cold-' + probe, '显式调试scope未执行冷探针', 'BLOCKED', 'not-executed', { probesOnly, sampleScope: 'current-geometry/minimal' }, ['AC-15-S'], [], ['未运行，不能用其他probe代验'])
            continue
          }
          const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
          page.setDefaultTimeout(15000)
          const pageErrors = [], requestFailures = [], routeTasks = []
          page.on('pageerror', error => pageErrors.push(error.message))
          page.on('requestfailed', request => requestFailures.push({ url: request.url(), error: request.failure()?.errorText || null }))
          let releasePanels, panelsRequested = false, observed, failure
          const held = new Promise(resolve => { releasePanels = resolve })
          const chunkPattern = /\.editor-panels\.js$/
          const beginFocusObservation = () => page.evaluate(() => {
            const ed = window.__coldApp.getWorkspace().$refs.document, editor = ed.editor, dom = editor.view.dom
            const parent = dom.parentNode, component = editor.contentComponent, container = component?.$el, componentParent = container?.parentNode
            const ancestors = new Set(); let ancestor = dom
            while (ancestor) { ancestors.add(ancestor); if (ancestor === ed.$refs.root) break; ancestor = ancestor.parentNode }
            const started = performance.now(), focusouts = [], mutations = [], beforeDestroy = []
            let totalMutations = 0, originalRemovalCount = 0, originalInsertionCount = 0
            const describe = node => !node ? null : ({ nodeType: node.nodeType, tag: node.nodeName,
              className: node.nodeType === 1 ? node.getAttribute('class') : null, id: node.nodeType === 1 ? node.id : null })
            const related = node => ancestors.has(node) || node === dom || Boolean(node.nodeType === 1 && node.contains(dom))
            const consume = records => {
              for (const record of records) {
                const removed = Array.from(record.removedNodes, node => ({ ...describe(node), originalDomOrAncestor: related(node) }))
                const added = Array.from(record.addedNodes, node => ({ ...describe(node), originalDomOrAncestor: related(node) }))
                originalRemovalCount += removed.filter(node => node.originalDomOrAncestor).length
                originalInsertionCount += added.filter(node => node.originalDomOrAncestor).length
                totalMutations++
                if (mutations.length < 128) mutations.push({ atMs: performance.now() - started, target: describe(record.target), removed, added })
              }
            }
            const observer = new MutationObserver(consume)
            observer.observe(ed.$refs.root, { childList: true, subtree: true })
            const onFocusout = event => {
              if (focusouts.length < 32) focusouts.push({ atMs: performance.now() - started, target: describe(event.target),
                relatedTarget: describe(event.relatedTarget), fromOriginalEditor: event.target === dom || dom.contains(event.target) })
            }
            document.addEventListener('focusout', onFocusout, true)
            const onBeforeDestroy = () => beforeDestroy.push({ atMs: performance.now() - started, componentName: component?.$options?.name,
              originalDomConnected: dom.isConnected, originalParent: describe(dom.parentNode) })
            if (typeof component?.$once === 'function') component.$once('hook:beforeDestroy', onBeforeDestroy)
            window.__coldFocusObservation = {
              snapshot() {
                consume(observer.takeRecords())
                const currentEditor = ed.editor, currentDom = currentEditor?.view?.dom, currentComponent = currentEditor?.contentComponent
                return { sameEditor: currentEditor === editor, sameDom: currentDom === dom, sameParent: dom.parentNode === parent,
                  sameContentComponent: currentComponent === component, sameContentContainer: currentComponent?.$el === container,
                  sameContentParent: currentComponent?.$el?.parentNode === componentParent,
                  originalDomConnected: dom.isConnected, originalParentConnected: parent?.isConnected,
                  componentObserved: Boolean(component), componentName: component?.$options?.name || null,
                  originalEditorParent: describe(parent), currentEditorParent: describe(dom.parentNode),
                  originalContentContainer: describe(container), currentContentContainer: describe(currentComponent?.$el),
                  focusouts: [...focusouts], beforeDestroy: [...beforeDestroy], mutations: [...mutations], totalMutations,
                  omittedMutations: Math.max(0, totalMutations - mutations.length), originalRemovalCount, originalInsertionCount }
              },
              stop() { observer.disconnect(); document.removeEventListener('focusout', onFocusout, true); component?.$off?.('hook:beforeDestroy', onBeforeDestroy) },
            }
            return { focused: dom.contains(document.activeElement), editorIsFocused: editor.isFocused, componentObserved: Boolean(component),
              componentName: component?.$options?.name || null, editorParent: describe(parent), contentContainer: describe(container) }
          })
          try {
            await page.route(chunkPattern, route => {
              panelsRequested = true
              const task = held.then(() => route.continue())
              routeTasks.push(task)
              return task
            })
            await page.goto(`http://127.0.0.1:${served.port}`, { waitUntil: 'domcontentloaded' })
            let timer
            try { await Promise.race([waitForHostReady(page), new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('COLD_HOST_READY_TIMEOUT')), 15000) })]) }
            finally { clearTimeout(timer) }
            const content = await page.evaluate(async html => {
              const app = window.__larkDoc.document, ed = app.getWorkspace().$refs.document
              // 只调宿主页面布局，让两段正文的光标位于视口下方，覆盖面板上下翻转。
              window.__larkDoc.style.marginTop = `${window.innerHeight}px`
              app.setContent(html); ed.setMode('edit')
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const editor = app.getEditor(), paragraphs = []
              editor.state.doc.forEach((node, pos) => { if (node.type.name === 'paragraph' && node.textContent.trim()) paragraphs.push(pos) })
              if (!paragraphs.length) throw new Error('COLD_PARAGRAPH_MISSING')
              const pos = paragraphs[paragraphs.length - 1]
              editor.chain().setTextSelection(pos + 1).focus().run()
              const target = editor.view.nodeDOM(pos)
              if (!(target instanceof Element)) throw new Error('COLD_PARAGRAPH_DOM_MISSING')
              target.scrollIntoView({ block: 'end', inline: 'nearest' })
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
              const coords = editor.view.coordsAtPos(pos + 1)
              window.scrollBy(0, coords.bottom - (window.innerHeight - 32))
              window.__coldApp = app
              const source = document.createElement('div'); source.innerHTML = html
              const last = editor.state.doc.lastChild
              return { sampleScope: 'current-geometry/minimal', logicalBlocks: 2, physicalBlocks: editor.state.doc.childCount, editable: editor.isEditable,
                textPreserved: source.textContent === editor.state.doc.textContent,
                emptyTrailingParagraph: last.type.name === 'paragraph' && last.content.size === 0,
                focused: editor.view.dom.contains(document.activeElement) }
            }, '<p>冷加载面板的前置正文</p><p>冷加载几何和焦点目标</p>')
            observed = { content }
            expect(content.physicalBlocks).toBe(2 + (content.emptyTrailingParagraph ? 1 : 0))
            expect(content.textPreserved).toBe(true); expect(content.editable).toBe(true); expect(content.focused).toBe(true)
            await page.waitForFunction(() => !document.querySelector('.lark-doc-block-handle-main'))
            expect(panelsRequested).toBe(true)
            if (probe === 'mention') {
              await page.evaluate(async () => {
                const ed = window.__coldApp.getWorkspace().$refs.document, capabilities = ed.session.getCapabilities()
                // 只注入未接通目录结果，不声称真实IdP/目录成功；让真实blocked空态参与高度计算。
                ed.session.setProvider('authorization', { isRemote: true, getCapabilities: async () => capabilities,
                  resolveMentions: async () => ({ status: 'blocked', code: 'DEPENDENCY_BLOCKED', sourceEpoch: '1', sourceSeq: '0' }) })
                await ed.session.refreshCapabilities()
                ed.startMention('mentionUser')
              })
              await page.waitForFunction(() => {
                const ed = window.__coldApp.getWorkspace().$refs.document
                return ed.mentionOpen && !ed.mentionLoading && ed.mentionRequestState?.status === 'blocked'
              })
              expect(await page.locator('.lark-doc-mention-panel').count()).toBe(0)
              await page.waitForFunction(() => window.__coldApp.getEditor().view.dom.contains(document.activeElement))
              await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
              const before = await page.evaluate(() => {
                const ed = window.__coldApp.getWorkspace().$refs.document, active = document.activeElement
                return { style: { ...ed.mentionStyle }, focused: ed.editor.view.dom.contains(active), editorIsFocused: ed.editor.isFocused,
                  activeElement: { tag: active?.tagName, className: active?.className, label: active?.getAttribute('aria-label') },
                  documentFocused: document.hasFocus(), selection: { from: ed.editor.state.selection.from, to: ed.editor.state.selection.to }, snapshot: ed.editor.getJSON() }
              })
              observed.beforeRelease = before
              expect(before.focused).toBe(true)
              observed.observationStart = await beginFocusObservation()
              releasePanels()
              await page.waitForSelector('.lark-doc-mention-panel')
              await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
              const geometry = await page.evaluate(() => {
                const ed = window.__coldApp.getWorkspace().$refs.document, panel = document.querySelector('.lark-doc-mention-panel')
                const rect = panel.getBoundingClientRect(), height = panel.offsetHeight
                const coords = ed.editor.view.coordsAtPos(ed.mentionRange.from)
                const active = document.activeElement
                return { height, coords: { top: coords.top, bottom: coords.bottom }, actualStyle: { ...ed.mentionStyle },
                  expectedStyle: ed.fitMentionStyle(coords, height), rect: { top: rect.top, left: rect.left },
                  focused: ed.editor.view.dom.contains(active), editorIsFocused: ed.editor.isFocused,
                  activeElement: { tag: active?.tagName, className: active?.className, label: active?.getAttribute('aria-label') },
                  documentFocused: document.hasFocus(), selection: { from: ed.editor.state.selection.from, to: ed.editor.state.selection.to }, snapshot: ed.editor.getJSON(), blocked: ed.mentionRequestState.status,
                  options: panel.querySelectorAll('[role="option"]').length, text: panel.textContent }
              })
              observed.afterRelease = geometry
              observed.focusObservation = await page.evaluate(() => window.__coldFocusObservation.snapshot())
              expect(geometry.height).toBeGreaterThan(168)
              expect(geometry.actualStyle).toEqual(geometry.expectedStyle)
              expect(Math.abs(geometry.rect.top - parseFloat(geometry.expectedStyle.top))).toBeLessThanOrEqual(1)
              expect(Math.abs(geometry.rect.left - parseFloat(geometry.expectedStyle.left))).toBeLessThanOrEqual(1)
              expect(Math.abs(parseFloat(geometry.actualStyle.top) - parseFloat(before.style.top))).toBeGreaterThan(1)
              expect(geometry.focused).toBe(true); expect(geometry.blocked).toBe('blocked'); expect(geometry.options).toBe(0)
              expect(geometry.snapshot).toEqual(before.snapshot); expect(geometry.selection).toEqual(before.selection)
              expect(geometry.text).toContain('未接通')
              observed = { ...observed, before, geometry, provider: 'injected-dependency-blocked; no real directory success claimed' }
            } else if (probe === 'calendar' || probe === 'calendar-cancelled') {
              const original = await page.evaluate(() => {
                const ed = window.__coldApp.getWorkspace().$refs.document, json = JSON.stringify(ed.editor.getJSON())
                ed.startCalendarEvent(); ed.calendarQuery = '冷加载日程'
                return json
              })
              expect(await page.evaluate(() => window.__coldApp.getWorkspace().$refs.document.calendarOpen)).toBe(true)
              expect(await page.locator('[aria-label="搜索日程"]').count()).toBe(0)
              const cancelled = probe === 'calendar-cancelled'
              if (cancelled) {
                await page.evaluate(() => { window.__coldApp.getWorkspace().$refs.document.closeCalendarSearch(); window.__coldApp.focus() })
                await page.waitForFunction(() => window.__coldApp.getEditor().view.dom.contains(document.activeElement))
                await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
                observed.beforeRelease = await page.evaluate(() => {
                  const editor = window.__coldApp.getEditor(), active = document.activeElement
                  return { focused: editor.view.dom.contains(active), editorIsFocused: editor.isFocused,
                    activeElement: { tag: active?.tagName, className: active?.className, label: active?.getAttribute('aria-label') },
                    documentFocused: document.hasFocus(), selection: { from: editor.state.selection.from, to: editor.state.selection.to }, snapshot: editor.getJSON() }
                })
                expect(observed.beforeRelease.focused).toBe(true)
                observed.observationStart = await beginFocusObservation()
              }
              releasePanels()
              await page.waitForFunction(() => window.__coldApp.getWorkspace().$refs.document.$children.some(child => child.$options.name === 'LarkDocCalendarSearchPanel' && child._isMounted))
              await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
              let focus
              if (cancelled) {
                expect(await page.locator('[aria-label="搜索日程"]').count()).toBe(0)
                focus = await page.evaluate(() => {
                  const editor = window.__coldApp.getEditor(), active = document.activeElement
                  return { focused: editor.view.dom.contains(active), editorIsFocused: editor.isFocused, absentInput: !document.querySelector('[aria-label="搜索日程"]'),
                    activeElement: { tag: active?.tagName, className: active?.className, label: active?.getAttribute('aria-label') },
                    documentFocused: document.hasFocus(), selection: { from: editor.state.selection.from, to: editor.state.selection.to }, snapshot: editor.getJSON() }
                })
                observed.afterRelease = focus
                observed.focusObservation = await page.evaluate(() => window.__coldFocusObservation.snapshot())
                expect(focus.focused).toBe(true)
                expect(focus.snapshot).toEqual(observed.beforeRelease.snapshot); expect(focus.selection).toEqual(observed.beforeRelease.selection)
              } else {
                await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '搜索日程')
                focus = await page.locator('[aria-label="搜索日程"]').evaluate(input => ({ focused: input === document.activeElement,
                  value: input.value, start: input.selectionStart, end: input.selectionEnd }))
                expect(focus.focused).toBe(true); expect(focus.value).toBe('冷加载日程')
                expect(focus.start).toBe(focus.value.length); expect(focus.end).toBe(focus.value.length)
                await page.locator('[aria-label="搜索日程"]').fill('日程实际输入')
                expect(await page.evaluate(() => window.__coldApp.getWorkspace().$refs.document.calendarQuery)).toBe('日程实际输入')
                await page.locator('.lark-doc-calendar-search [aria-label="关闭"]').click()
                expect(await page.locator('[aria-label="搜索日程"]').count()).toBe(0)
              }
              expect(await page.evaluate(() => JSON.stringify(window.__coldApp.getEditor().getJSON()))).toBe(original)
              observed = { ...observed, cancelledBeforeRelease: cancelled, focus, closedWithoutBodyChange: true }
            } else {
              const before = await page.evaluate(() => {
                const ed = window.__coldApp.getWorkspace().$refs.document
                ed.positionBlockHandle(ed.currentBlockRange())
                const node = ed.editor.view.nodeDOM(ed.handleRange.from), paper = ed.$refs.root.querySelector('.lark-doc-paper')
                const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
                let text = walker.nextNode()
                while (text && !text.textContent.trim()) text = walker.nextNode()
                if (!text) throw new Error('COLD_HANDLE_TEXT_MISSING')
                const ink = document.createRange(), start = text.textContent.search(/\S/)
                ink.setStart(text, start); ink.setEnd(text, start + 1)
                const rect = ink.getBoundingClientRect(), paperRect = paper.getBoundingClientRect()
                const inkCenter = (rect.top + rect.bottom) / 2
                return { top: ed.blockHandlePosition.top, inkCenter, paperTop: paperRect.top, paperBorder: paper.clientTop || 0,
                  expectedFallbackTop: Math.max(0, Math.round((inkCenter - paperRect.top - (paper.clientTop || 0) - 30 / 2) * 2) / 2),
                  absentHandle: !ed.$refs.root.querySelector('.lark-doc-block-handle-main') }
              })
              observed.beforeRelease = before
              expect(before.absentHandle).toBe(true); expect(before.top).toBe(before.expectedFallbackTop)
              releasePanels()
              await page.waitForSelector('.lark-doc-block-handle-main')
              await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
              const geometry = await page.evaluate(() => {
                const ed = window.__coldApp.getWorkspace().$refs.document, handle = ed.$refs.root.querySelector('.lark-doc-block-handle-main')
                const node = ed.editor.view.nodeDOM(ed.handleRange.from), walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
                let text = walker.nextNode()
                while (text && !text.textContent.trim()) text = walker.nextNode()
                if (!text) throw new Error('COLD_HANDLE_TEXT_MISSING')
                const ink = document.createRange(), start = text.textContent.search(/\S/)
                ink.setStart(text, start); ink.setEnd(text, start + 1)
                const line = ink.getBoundingClientRect(), rect = handle.getBoundingClientRect()
                const toggle = node.querySelector('.lark-doc-heading-fold-toggle'), fold = toggle?.getBoundingClientRect()
                return { height: rect.height, center: (rect.top + rect.bottom) / 2,
                  expectedCenter: fold ? (fold.top + fold.bottom) / 2 : (line.top + line.bottom) / 2,
                  anchor: fold ? 'real-fold-toggle' : 'real-first-line-DOM-Range', top: ed.blockHandlePosition.top }
              })
              observed.afterRelease = geometry
              expect(geometry.height).toBe(26)
              expect(Math.abs(geometry.center - geometry.expectedCenter)).toBeLessThanOrEqual(1)
              expect(geometry.top - before.top).toBe(2)
              observed = { content, before, geometry }
            }
            await page.waitForLoadState('networkidle', { timeout: 15000 })
            expect(pageErrors).toEqual([]); expect(requestFailures).toEqual([])
          } catch (error) {
            failure = { error: error.message, stack: error.stack || null }
            try {
              const failureFocus = await page.evaluate(() => {
                const editor = window.__coldApp?.getEditor(), active = document.activeElement
                return { focused: Boolean(editor?.view?.dom.contains(active)), editorIsFocused: editor?.isFocused,
                  activeElement: { tag: active?.tagName, className: active?.className, label: active?.getAttribute('aria-label') },
                  documentFocused: document.hasFocus(), snapshot: editor?.getJSON() }
              })
              observed = { ...observed, failureFocus }
              const focusObservation = await page.evaluate(() => window.__coldFocusObservation?.snapshot() || null)
              if (focusObservation) observed.focusObservation = focusObservation
            } catch (diagnosticError) { observed = { ...observed, diagnosticError: diagnosticError.message } }
          }
          finally {
            releasePanels()
            try { await page.evaluate(() => window.__coldFocusObservation?.stop()) }
            catch (error) { if (!failure) failure = { error: error.message, stage: 'focus-observer-stop' } }
            const continued = await Promise.allSettled(routeTasks)
            const routeFailure = continued.find(item => item.status === 'rejected')
            if (routeFailure && !failure) failure = { error: routeFailure.reason.message, stage: 'route-release' }
            try { await page.unroute(chunkPattern) }
            catch (error) { if (!failure) failure = { error: error.message, stage: 'unroute' } }
            try { await page.close() }
            catch (error) { if (!failure) failure = { error: error.message, stage: 'page-close' } }
          }
          if ((pageErrors.length || requestFailures.length) && !failure) failure = { error: 'COLD_PAGE_OR_REQUEST_FAILURE' }
          step('cold-' + probe, '独立最小几何样本冷chunk：' + probe, failure ? 'FAIL' : 'PASS', 'real-browser',
            { ...observed, panelsRequested, pageErrors, requestFailures, ...(failure || {}) }, ['AC-15-S', 'AC-15-Q'], [],
            probe === 'mention' ? ['仅目录端口注入DEPENDENCY_BLOCKED；真实DOM/高度/正文焦点，不代表内部目录成功链'] : [])
        }
        // 原生import与Vue peer另用空HTML，不让Element全局或其预装样式替ESM模块接线兜底。
        const esmDirectory = path.join(REPO_ROOT, 'dist'), esmEntry = path.join(esmDirectory, 'lark-doc.esm.js')
        const esmRequired = ['lark-doc.esm.js', 'lark-doc-providers.esm.js', 'tiptap.esm.js', 'vendor.esm.js']
        const missingEsm = esmRequired.filter(file => !fs.existsSync(path.join(esmDirectory, file)))
        const vuePeer = path.join(REPO_ROOT, 'node_modules/vue/dist/vue.esm.browser.min.js')
        const esmAttested = !missingEsm.length && config.esmSourceHash === report.revisions.frontend.sourceHash &&
          config.esmEntrySha256 === sha256(fs.readFileSync(esmEntry))
        if (probesOnly !== null && !probesOnly.includes('native-esm-providers')) {
          step('native-esm-providers', '显式调试scope未执行原生ESM探针', 'BLOCKED', 'not-executed', { probesOnly }, ['AC-15-S'], [], ['未加载ESM/Vue peer，不算当前原生import通过'])
        } else if (!esmAttested || !fs.existsSync(vuePeer)) {
          step('native-esm-providers', '原生ESM/providers分块与Vue2 peer尚缺当前工件', 'BLOCKED', 'not-executed',
            { missingEsm, peerAvailable: fs.existsSync(vuePeer), sourceAttested: esmAttested }, ['AC-15-S'], ['npm', 'run', 'build:esm'],
            ['需实际构建当前ESM并供给esmSourceHash/esmEntrySha256；旧dist或仅配置cacheGroup不能算原生import通过'])
        } else {
          const esmFiles = fs.readdirSync(esmDirectory).filter(file => file.endsWith('.esm.js'))
          for (const file of esmFiles) {
            fs.copyFileSync(path.join(esmDirectory, file), path.join(host, file))
            report.artifacts.push(artifact(path.join(esmDirectory, file), 'frontend', 'native-esm-' + file, config.esmSourceHash))
          }
          fs.copyFileSync(vuePeer, path.join(host, 'vue-peer.esm.js'))
          report.artifacts.push(artifact(vuePeer, 'fixture', 'native-esm-installed-vue2-peer'))
          fs.writeFileSync(path.join(host, 'esm-native.html'), [
            '<!doctype html><html><head><meta charset="utf-8">',
            '<script type="importmap">{"imports":{"vue":"./vue-peer.esm.js"}}</script>',
            '</head><body><div id="esm-editor" style="width:960px;height:860px;margin:12px auto"></div></body></html>',
          ].join('\n'))
          const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
          page.setDefaultTimeout(15000)
          const origin = `http://127.0.0.1:${served.port}`, pageErrors = [], requestFailures = [], externalRequests = [], providerResponses = []
          page.on('pageerror', error => pageErrors.push(error.message))
          page.on('requestfailed', request => requestFailures.push({ url: request.url(), error: request.failure()?.errorText || null }))
          page.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) externalRequests.push(request.url()) })
          page.on('response', response => {
            if (new URL(response.url()).pathname.endsWith('/lark-doc-providers.esm.js')) providerResponses.push({
              url: response.url(), status: response.status(), contentType: response.headers()['content-type'] || null,
            })
          })
          let observed, failure
          try {
            const sourceProviderExports = await import('../../src/providers/index.js')
            const providerTypes = Object.fromEntries(Object.entries(sourceProviderExports).map(([name, value]) => [name, typeof value]))
            const entrySource = fs.readFileSync(path.join(REPO_ROOT, 'src/index.js'), 'utf8')
            const exportBlocks = [...entrySource.matchAll(/^export\s*{([^}]+)}/gm)]
            if (!exportBlocks.length) throw new Error('SOURCE_ESM_EXPORT_BLOCK_MISSING')
            const mainNames = [...new Set([...exportBlocks.flatMap(block => block[1].split(',').map(name => name.trim()).filter(Boolean)), 'default'])].sort()
            expect(mainNames.every(name => /^[A-Za-z_$][\w$]*$/.test(name))).toBe(true)
            const functionNames = new Set(['default', 'LarkDoc', 'DocumentSession', 'loadCollaboration', 'createLarkDoc', 'createWorkspace', 'createLarkDocConfig',
              'createEcsImageUpload', 'resolveToolbarKeys', 'createNetworkPolicy', 'detectLegacyHtml', 'isVditorHtml', 'normalizeVditorHtml', 'createDocumentSession'])
            // Webpack的原生ESM初始/懒分块通过此既有命名导出共享运行时；它不属于src/index的公开入口清单。
            const mainTypes = Object.fromEntries([...mainNames.map(name => [name, functionNames.has(name) ? 'function' : 'object']), ['__webpack_require__', 'function']])
            await page.goto(origin + '/esm-native.html', { waitUntil: 'domcontentloaded' })
            expect(await page.evaluate(() => !document.querySelector('lark-doc') && !window.__larkDoc && !window['lark-doc-element'])).toBe(true)
            let timer, mounted
            try {
              mounted = await Promise.race([page.evaluate(async () => {
                // 字符串内的浏览器原生import不经过Vitest SSR改写；URL只来自本fixture固定同源路径。
                const sdk = await Function('url', 'return import(url)')(new URL('./lark-doc.esm.js', window.location.href).href)
                const types = value => Object.fromEntries(Object.entries(value).map(([name, item]) => [name, typeof item]))
                const supplied = { getCapabilities: () => ({ canView: true }) }
                const factories = { authorizationSynchronousIdentity: sdk.providers.createAuthorizationProvider(supplied) === supplied,
                  resourceNull: sdk.providers.createResourceProvider(null), collaborationNull: sdk.providers.createCollaborationProvider(null) }
                const app = new sdk.LarkDoc({ element: document.getElementById('esm-editor'), storage: 'none' })
                window.__nativeEsmApp = app
                const deadline = performance.now() + 15000
                while (!app.getEditor()) {
                  if (performance.now() >= deadline) throw new Error('NATIVE_ESM_EDITOR_TIMEOUT')
                  await new Promise(resolve => setTimeout(resolve, 20))
                }
                app.setContent('<p>原生ESM模块接线</p>'); app.focus()
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
                return { mainTypes: types(sdk), providerTypes: types(sdk.providers), factories,
                  defaultIsLarkDoc: sdk.default === sdk.LarkDoc, text: app.getEditor().getText(),
                  focused: app.getEditor().view.dom.contains(document.activeElement) }
              }), new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('NATIVE_ESM_IMPORT_OR_MOUNT_TIMEOUT')), 15000) })])
            } finally { clearTimeout(timer) }
            expect(mounted.mainTypes).toEqual(mainTypes); expect(mounted.providerTypes).toEqual(providerTypes)
            expect(mounted.defaultIsLarkDoc).toBe(true)
            expect(mounted.factories).toEqual({ authorizationSynchronousIdentity: true, resourceNull: null, collaborationNull: null })
            expect(mounted.text).toContain('原生ESM模块接线'); expect(mounted.focused).toBe(true)
            await page.keyboard.insertText('native-esm-probe')
            const after = await page.evaluate(() => {
              const app = window.__nativeEsmApp, editor = app.getEditor(), text = editor.getText()
              app.destroy(); app.destroy()
              return { text, destroyed: editor.isDestroyed, remainingEditors: document.querySelectorAll('.ProseMirror').length }
            })
            expect(after.text).toContain('native-esm-probe'); expect(after.destroyed).toBe(true); expect(after.remainingEditors).toBe(0)
            await page.waitForLoadState('networkidle', { timeout: 15000 })
            expect(providerResponses.some(response => response.status === 200 && /^(?:text|application)\/javascript(?:;|$)/i.test(response.contentType))).toBe(true)
            expect(pageErrors).toEqual([]); expect(requestFailures).toEqual([]); expect(externalRequests).toEqual([])
            observed = { esmFiles, providerResponses, mounted, after }
          } catch (error) { failure = { error: error.message, stack: error.stack || null } }
          finally {
            try { await page.close() }
            catch (error) { if (!failure) failure = { error: error.message, stage: 'native-page-close' } }
          }
          if ((pageErrors.length || requestFailures.length || externalRequests.length) && !failure) failure = { error: 'NATIVE_ESM_PAGE_OR_REQUEST_FAILURE' }
          step('native-esm-providers', '真实native imports/providers分块/Vue2 peer接线与输入销毁', failure ? 'FAIL' : 'PASS', 'real-browser',
            { ...observed, providerResponses, pageErrors, requestFailures, externalRequests, ...(failure || {}) }, ['AC-15-S', 'AC-15-Q'], [],
            ['最小正文仅验证当前ESM公开导出/同步工厂/初始chunk和Vue peer；不代表PG/SSO/目录或2000块性能，原六cell样本保持不变'])
        }
      } else step('native-esm-providers', '原生ESM探针缺共享实际浏览器环境', 'BLOCKED', 'not-executed', null, ['AC-15-S'], [], ['先提供当前Element矩阵制品以复用既有静态server/browser；不另造服务编排'])
      for (const filename of config.nativeReports || []) {
        if (probesOnly !== null) {
          step('native-import-' + report.steps.length, '显式调试scope不导入未选原生矩阵单元', 'BLOCKED', 'not-executed', { filename, probesOnly }, ['AC-15-S'], [], ['probesOnly不能用旧报告把未选矩阵改成PASS'])
          continue
        }
        const imported = JSON.parse(fs.readFileSync(filename, 'utf8'))
        const checked = validateEvidence(imported)
        const sameArtifacts = imported.revisions.frontend.sourceHash === report.revisions.frontend.sourceHash && imported.artifacts.some(item => bundle && item.sha256 === sha256(bundle))
        if (!checked.valid || !sameArtifacts) { step('native-import-' + report.steps.length, '原生浏览器报告不可比', 'BLOCKED', 'not-executed', null, ['AC-15-S'], [], ['原报告schema/制品/源指纹不符；不改写历史报告']); continue }
        for (const item of imported.steps.filter(item => item.status === 'PASS' && item.observed && MATRIX.some(cell => cell.id === item.observed.matrixCell))) {
          if (item.observed.matrixCell.startsWith('safari-native/') && !(item.observed.browser && item.observed.browser.name === 'Safari' && item.observed.browser.automation === 'native-safaridriver' && item.observed.browser.native === true)) continue
          if (item.observed.matrixCell.startsWith('touch-hardware/') && !(item.executionType === 'hardware-device' && item.observed.device === 'touch-hardware')) continue
          if (report.steps.some(existing => existing.id === item.id)) continue
          step(item.id, item.name, 'PASS', item.executionType, item.observed, item.acIds, [], ['原始同制品报告：' + filename])
        }
        report.artifacts.push(artifact(filename, 'raw-report', 'native-import-' + report.artifacts.length))
      }
    } catch (error) { step('matrix-runtime', '矩阵运行环境', 'BLOCKED', 'not-executed', { error: error.message }, ['AC-15-S'], [], ['环境不足不能以其他浏览器或mock代验']) }
    finally {
      if (browser) await browser.close()
      if (server) await new Promise(resolve => server.close(resolve))
      // Keep copied host bytes: report artifacts refer to them and failures must remain auditable.
    }
    for (const cell of MATRIX) if (!report.steps.some(item => item.observed && item.observed.matrixCell === cell.id)) step(cell.id, '缺真实矩阵单元', 'BLOCKED', 'not-executed', { matrixCell: cell.id }, ['AC-15-S', 'AC-15-Q'], [], ['需要对应真实浏览器/真机触控原始报告；不使用WebKit/触控模拟冒充'])
    for (const filename of config.previousReports || []) {
      const previous = JSON.parse(fs.readFileSync(filename, 'utf8'))
      report.previousRuns.push({ runId: previous.runId, status: previous.status, report: artifact(filename, 'raw-report', previous.runId) })
    }
    const unchanged = inputFiles.every(file => fs.existsSync(file) && sha256(fs.readFileSync(file)) === inputSha256[file])
    step('source-stability', '矩阵执行前后生产源码指纹保持一致', unchanged ? 'PASS' : 'FAIL', 'static', { inputSha256, unchanged }, ['AC-15-R'])
    report.limitations.push('原生宿主由Vue2/Webpack原制品提供；没有替换应用构建器。后台/对象/翻译/通知各故事需独立真实证据，不从本矩阵UI推断。')
    report.claims.nativeSafari = MATRIX.filter(cell => cell.browser === 'safari-native').every(cell => report.steps.some(item => item.status === 'PASS' && item.observed && item.observed.matrixCell === cell.id))
    report.claims.hardwareTouch = MATRIX.filter(cell => cell.browser === 'touch-hardware').every(cell => report.steps.some(item => item.status === 'PASS' && item.observed && item.observed.matrixCell === cell.id))
    report.claims.realBrowserMatrix = MATRIX.every(cell => report.steps.some(item => item.status === 'PASS' && item.observed && item.observed.matrixCell === cell.id))
    const missingStories = ['US4', 'US5', 'US6', 'US9', 'US10', 'US13'].filter(story => !coveredStories.includes(story))
    if (missingStories.length) report.blockedReasons.push('真实翻译及评论/通知/对象等首发轨迹未具完整原始证据：' + missingStories.join(','))
    report.acIndex = AC_IDS.map(acId => {
      const linked = report.steps.filter(item => item.acIds.includes(acId))
      const proven = acId === 'AC-15-S' ? report.claims.realBrowserMatrix : backendCoverage.includes(acId)
      return { acId, status: linked.some(item => item.status === 'FAIL') ? 'FAIL' : proven && linked.length && linked.every(item => item.status === 'PASS') ? 'PASS' : 'BLOCKED', stepIds: linked.map(item => item.id) }
    })
    for (const item of report.acIndex) if (item.status === 'BLOCKED') report.blockedReasons.push(item.acId + '缺对应真实当前报告，不从测试名字或UI外观推断覆盖')
    report.status = report.steps.some(item => item.status === 'FAIL') || report.acIndex.some(item => item.status === 'FAIL') ? 'FAIL' : report.blockedReasons.length ? 'BLOCKED' : 'PASS'
    report.endedAt = new Date().toISOString()
    const validation = validateEvidence(report)
    if (!validation.valid) { report.status = 'FAIL'; report.limitations.push(...validation.errors) }
    const saved = preserveReport(directory, report)
    console.log(`US15 ${report.status}: ${saved.path}`)
    expect(validation.errors).toEqual([])
    expect(report.status, '缺真实项仍必须BLOCKED，不能当已通过').toBe('PASS')
  }, 900000)
})


// Focused real-Chrome geometry regression. These fixtures verify CSS hit testing,
// not provider/auth/backend behavior; the production environment covers those separately.
if (process.env.LARK_UI_LAYER_REGRESSION === '1') describe('非模态评论与导出菜单真实浏览器层级', () => {
  it('新评论和已有评论共同打开时不重叠，短窗也能鼠标发送两种评论', async () => {
    const executablePath = findChromium()
    if (!executablePath) throw new Error('CHROMIUM_UNAVAILABLE')
    const chrome = await loadChromiumDriver().launch({ executablePath, headless: true })
    try {
      const page = await chrome.newPage()
      const css = fs.readFileSync(path.join(REPO_ROOT, 'src/components/lark-doc/lark-doc.css'), 'utf8') + '\n' + fs.readFileSync(path.join(REPO_ROOT, 'src/styles/comments.css'), 'utf8')
      for (const width of [375, 768, 1440]) for (const height of [360, 600, 900]) {
        await page.setViewportSize({ width, height })
        await page.setContent(`<style>${css}</style><div class="lark-doc"><div class="lark-doc-comment-layer is-remote"><section class="lark-doc-comment-composer"><label>新评论<textarea id="new"></textarea></label><button id="create">评论全文</button></section><div class="lark-doc-comment-panel is-remote"><div class="lark-doc-comment-head">已有评论</div><div class="lark-doc-comment-replies">${'<p>评论正文</p>'.repeat(30)}</div><div style="flex:0 0 auto"><label>回复<textarea id="reply"></textarea></label><button id="send">发送</button></div></div></div></div>`)
        const rects = await page.evaluate(() => ({ panel: document.querySelector('.lark-doc-comment-panel').getBoundingClientRect().toJSON(), composer: document.querySelector('.lark-doc-comment-composer').getBoundingClientRect().toJSON() }))
        expect(rects.panel.bottom).toBeLessThanOrEqual(rects.composer.top)
        expect(rects.panel.top).toBeGreaterThanOrEqual(0)
        await page.evaluate(() => { document.getElementById('send').onclick = () => { document.body.dataset.reply = document.getElementById('reply').value }; document.getElementById('create').onclick = () => { document.body.dataset.created = document.getElementById('new').value } })
        await page.locator('#reply').fill('reply'); await page.locator('#send').click({ timeout: 2000 })
        await page.locator('#new').fill('new'); await page.locator('#create').click({ timeout: 2000 })
        expect(await page.evaluate(() => ({ reply: document.body.dataset.reply, created: document.body.dataset.created }))).toEqual({ reply: 'reply', created: 'new' })
      }
    } finally { await chrome.close() }
  }, 30000)
  it('拥挤标题栏的首个模式入口不会落入不可滚动的左侧裁剪区', async () => {
    const executablePath = findChromium()
    if (!executablePath) throw new Error('CHROMIUM_UNAVAILABLE')
    const chrome = await loadChromiumDriver().launch({ executablePath, headless: true })
    try {
      const page = await chrome.newPage()
      const css = fs.readFileSync(path.join(REPO_ROOT, 'src/components/lark-doc/lark-doc.css'), 'utf8')
      for (const width of [768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 800 })
        await page.setContent(`<style>${css}</style><section class="lark-doc"><header class="lark-doc-topbar"><div class="lark-doc-brand">文档</div><div class="lark-doc-title-wrap"><input value="测试文档"></div><div class="lark-doc-header-actions"><button id="mode" style="flex:0 0 96px">编辑</button>${Array.from({ length: 10 }, (_, i) => `<button style="flex:0 0 80px">操作${i}</button>`).join('')}<button id="export" style="flex:0 0 80px">导出</button></div></header></section>`)
        const first = await page.locator('#mode').evaluate(el => {
          const r = el.getBoundingClientRect(), container = el.parentElement.getBoundingClientRect()
          return { left: r.left, containerLeft: container.left, hit: el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) }
        })
        expect(first.left).toBeGreaterThanOrEqual(first.containerLeft)
        expect(first.hit).toBe(true)
        await page.locator('#mode').click()
        await page.locator('#export').click()
      }
    } finally { await chrome.close() }
  }, 30000)
  it('普通/吸顶标题栏在窄窗和宽窗都能直接鼠标打开并选择导出，保留评论交互', async () => {
    const executablePath = findChromium()
    if (!executablePath) throw new Error('CHROMIUM_UNAVAILABLE')
    const chrome = await loadChromiumDriver().launch({ executablePath, headless: true })
    const css = fs.readFileSync(path.join(REPO_ROOT, 'src/components/lark-doc/lark-doc.css'), 'utf8') + '\n' + fs.readFileSync(path.join(REPO_ROOT, 'src/styles/comments.css'), 'utf8')
    const observations = []
    try {
      for (const width of [768, 1440]) for (const sticky of [false, true]) for (const surface of ['lark-doc-comment-panel', 'lark-doc-comment-composer']) {
        const page = await chrome.newPage({ viewport: { width, height: 900 } })
        try {
          await page.setContent(`<style>${css}</style><div class="lark-doc ${sticky ? 'lark-doc-titlebar-fixed' : ''}"><header class="lark-doc-topbar"><div class="lark-doc-header-actions"><span class="lark-doc-select"><button id="export" class="lark-doc-select-trigger">导出</button><div id="menu" class="lark-doc-select-menu" style="display:none" role="listbox"><button id="txt" role="option">纯文本</button></div></span></div></header><div class="lark-doc-p6b-layer"><div id="comment" class="${surface}"><button id="reply">回复</button></div></div></div>`)
          await page.evaluate(() => {
            const trigger = document.getElementById('export'), rect = trigger.getBoundingClientRect(), panel = document.getElementById('comment'), menu = document.getElementById('menu')
            // Deliberately overlap the actual stylesheet's nonmodal surfaces with the trigger/menu.
            Object.assign(panel.style, { left: rect.left + 'px', top: rect.top + 'px', bottom: 'auto', right: 'auto', height: '160px' })
            Object.assign(menu.style, { left: rect.left + 'px', top: rect.bottom + 4 + 'px' })
            trigger.onclick = () => { menu.style.display = 'grid' }
            document.getElementById('txt').onclick = () => { document.body.dataset.selected = 'txt'; menu.style.display = 'none' }
            document.getElementById('reply').onclick = () => { document.body.dataset.reply = 'clicked' }
          })
          await page.getByRole('button', { name: '导出', exact: true }).click({ timeout: 2000 })
          await page.getByRole('option', { name: '纯文本', exact: true }).click({ timeout: 2000 })
          expect(await page.evaluate(() => document.body.dataset.selected)).toBe('txt')
          await page.evaluate(() => { document.getElementById('comment').style.top = '200px' })
          await page.getByRole('button', { name: '回复', exact: true }).click({ timeout: 2000 })
          expect(await page.evaluate(() => document.body.dataset.reply)).toBe('clicked')
          observations.push({ width, sticky, surface, mouseExport: true, commentInteractive: true })
        } finally { await page.close() }
      }
      console.log(JSON.stringify({ browser: chrome.version(), cssSha256: sha256(css), observations }))
    } finally { await chrome.close() }
  }, 60000)
})
