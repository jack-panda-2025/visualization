import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import PointsView from './components/PointsView'
import SurfaceView from './components/SurfaceView'

// Two fully separate comparison pages, each with its own URL:
//
//   ?points=<stem>    point cloud, truth vs prediction
//   ?surface=<stem>   shaded skin, truth vs prediction
//
// They share no view state and no rendering code — only the data layer. Both
// are routed here rather than inside App so the single-simulation loader never
// runs; it would otherwise pull its own 151 MB file first.
const params = new URLSearchParams(window.location.search)
const surfaceStem = params.get('surface')
// ?compare= was the original single page; keep it working, pointed at points.
const pointsStem = params.get('points') ?? params.get('compare')

const go = (page: 'points' | 'surface', stem: string) => {
  window.location.href = `${window.location.pathname}?${page}=${encodeURIComponent(stem)}`
}
const exitToSingle = () => { window.location.href = window.location.pathname }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {surfaceStem
      ? <SurfaceView stem={surfaceStem} onExit={exitToSingle}
          onPoints={() => go('points', surfaceStem)} />
      : pointsStem
        ? <PointsView stem={pointsStem} onExit={exitToSingle}
            onSurface={() => go('surface', pointsStem)} />
        : <App />}
  </StrictMode>,
)
