import React, { useEffect, useRef, useState } from 'react'
import { LarkDoc } from 'lark-doc'
import 'lark-doc/style.css'

export default function App() {
  const host = useRef(null)
  const doc = useRef(null)
  const [ready, setReady] = useState(false)
  const [updates, setUpdates] = useState(0)
  const [uploadStatus, setUploadStatus] = useState('等待选图（本地 base64）')
  const [output, setOutput] = useState('')

  useEffect(() => {
    const instance = new LarkDoc({
      element: host.current,
      title: 'React + Vite',
      content: '<p>开始编辑，也可以选图、粘贴或拖入图片。</p>',
      storage: 'none',
      uploader: {
        onStart: event => setUploadStatus(`上传中（${event.mode}）`),
        onSuccess: () => setUploadStatus('取得图片结果'),
        onError: event => setUploadStatus(event.error.message),
        onSettled: event => setUploadStatus(`${event.status}（${event.mode}）`),
      },
      onReady: () => setReady(true),
      onUpdate: () => setUpdates(value => value + 1),
    })
    doc.current = instance
    return () => { instance.destroy(); doc.current = null }
  }, [])

  return <main>
    <style>{`body { margin: 0; font: 14px system-ui, sans-serif; color: #243042; background: #f6f8fc; } main { padding: 16px; } button { padding: 7px 12px; cursor: pointer; } pre { max-height: 220px; overflow: auto; white-space: pre-wrap; } .status { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 12px; }`}</style>
    <div className="status">
      <strong>React {React.version} + Vite</strong>
      <span>正文更新：{updates}</span>
      <span role="status">图片：{uploadStatus}</span>
      <button disabled={!ready} onClick={() => setOutput(JSON.stringify({ title: doc.current.getTitle(), content: doc.current.getJSON() }, null, 2))}>读取 JSON</button>
    </div>
    <div ref={host} />
    {output && <pre>{output}</pre>}
  </main>
}
