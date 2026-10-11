import { memo } from 'react'
import { sky, weatherFlags } from '../lib/conditions'
import { km } from '../lib/geo'
import type { OnRoute, Station, Weather } from '../lib/types'
import { ago } from '../lib/geo'
import { Icon } from './Icon'

function WeatherPanelView({ weather, stations }: { weather: Weather[]; stations: OnRoute<Station>[] }) {
  if (!weather.length) return <div className="quiet"><span className="spinner" /><p>Checking the weather along your route…</p></div>
  return (
    <>
    <ol className="wx-list">
      {weather.map((w) => {
        const s = sky(w.code), flags = weatherFlags(w)
        return (
          <li key={`${w.lat},${w.lon}`}>
            <article className={`wx ${flags.length ? 'has-flags' : ''}`}>
              <span className="wx-rail" aria-hidden><i /></span>
              <div className="wx-place">
                <b>{w.label}</b>
                <span className="mono">{w.along ? `${km(w.along)} in` : 'Start'}</span>
              </div>
              <div className="wx-now">
                <Icon name={s.icon} size={22} />
                <strong className="tnum">{Math.round(w.temp)}°</strong>
              </div>
              <div className="wx-detail">
                <span>{s.text}</span>
                <span className="tnum"><Icon name="wind" size={13} /> {Math.round(w.wind)} km/h{w.gusts >= 40 ? ` · gusts ${Math.round(w.gusts)}` : ''}</span>
                <span className="tnum">Feels {Math.round(w.feels)}° · {w.nextPrecip}% precip next 3 h</span>
                {flags.length > 0 && <span className="wx-flags">{flags.map((f) => <em key={f}>{f}</em>)}</span>}
              </div>
            </article>
          </li>
        )
      })}
    </ol>
    {stations.length > 0 && (
      <section className="roads">
        <h3 className="sub-h">Road surface <span className="tag">511</span></h3>
        <ul className="surf-list">
          {stations.map((s) => (
            <li key={s.id} className={s.pavement <= 0 ? 'icy' : s.pavement <= 3 ? 'cold' : ''}>
              <span className="surf-pave tnum">{s.pavement.toFixed(0)}°<small>pavement</small></span>
              <span className="surf-meta"><b className="tnum">{km(s.along)} in</b><span className="tnum">Air {s.air.toFixed(0)}° · wind {Math.round(s.wind)} km/h · {ago(s.updated)}</span></span>
              {s.pavement <= 0 && <em>Ice possible</em>}
            </li>
          ))}
        </ul>
      </section>
    )}
    </>
  )
}

export const WeatherPanel = memo(WeatherPanelView)
