/**
 * lark-doc 防闪片段（12 T1-07）—— 供宿主内联到 <head>，约 15 行、零依赖。
 *
 * 用法：构建期把本文件内容原样注入宿主 HTML 的 <head>（或手工内联），
 * 它会在编辑器脚本加载前，按 localStorage / 系统偏好把主题属性写到 <html> 上，
 * 消除深色宿主刷新时的首帧闪白。
 *
 * 注意：这里写的是 documentElement —— 片段执行时编辑器还没挂载；挂载后由
 * theme controller 把同样的属性写到 .lark-doc 根容器上（requirements/11 §3.3），
 * 两层取值口径一致，互不冲突。片段可重复执行，任何环境异常都静默吞掉。
 */
(function () {
  try {
    var read = function (key) { try { return window.localStorage.getItem(key) } catch (error) { return null } }
    var storedTheme = read('lark-doc:theme')
    var storedContent = read('lark-doc:content-theme')
    var systemDark = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
    var theme = storedTheme === 'dark' || storedTheme === 'light' ? storedTheme : (systemDark ? 'dark' : 'light')
    var content = storedContent === 'dark' || storedContent === 'light' ? storedContent : theme
    var root = document.documentElement
    root.setAttribute('data-theme', theme)
    root.setAttribute('data-content-theme', content)
    root.style.colorScheme = theme
  } catch (error) { /* 无 DOM / 隐私模式：静默跳过，交给运行时 theme controller 兜底 */ }
})()
