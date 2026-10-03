// Barra de progreso global: cuenta las operaciones de red en curso para que
// <TopProgress /> se muestre sólo cuando alguna tarda de verdad.
const suscriptores = new Set()
let activas = 0

const avisar = () => suscriptores.forEach((fn) => fn(activas))

export function seguirProgreso(promesa) {
  activas += 1
  avisar()
  return Promise.resolve(promesa).finally(() => {
    activas = Math.max(0, activas - 1)
    avisar()
  })
}

export function suscribirProgreso(fn) {
  suscriptores.add(fn)
  fn(activas)
  return () => suscriptores.delete(fn)
}

export const fetchConProgreso = (...args) => seguirProgreso(fetch(...args))
