import { describe, expect, it } from 'vitest'
import { asociacionNota, clienteDeNota, etiquetaClienteNota, nombreDeNota, notaDelCliente } from './clientNotes.js'

const clientes = [{id:1,barberia_id:10,nombre:'Juan',telefono:'549110001'}, {id:2,barberia_id:10,nombre:'Juan',telefono:'549110002'}]

describe('Identidad de notas (43)', () => {
  it('resuelve tipos numéricos/textuales sin comparar nombres', () => {
    expect(notaDelCliente({cliente_id:'1',paciente:'Otro nombre'},clientes[0])).toBe(true)
    expect(notaDelCliente({cliente_id:2,paciente:'Juan'},clientes[0])).toBe(false)
  })
  it('no adivina vínculo de legado, general o ficha eliminada', () => {
    for (const note of [{paciente:'Juan'}, {cliente_id:null,paciente:'General'}, {cliente_id:8,paciente:'Juan'}]) {
      expect(clienteDeNota(note,clientes)).toBeNull()
    }
  })
  it('rechaza pertenencia explícita a otro negocio aun con el mismo id', () => {
    expect(notaDelCliente({cliente_id:1,barberia_id:20},clientes[0])).toBe(false)
  })
  it('renombrar muestra el nombre actual y conserva el vínculo', () => {
    const note={cliente_id:1,paciente:'Juan'}
    expect(nombreDeNota(note,[{...clientes[0],nombre:'Juan Nuevo'}])).toBe('Juan Nuevo')
  })
  it('discrimina homónimos en la selección sin mostrar ids internos', () => {
    expect(etiquetaClienteNota(clientes[0],clientes)).toBe('Juan · …0001')
    expect(etiquetaClienteNota(clientes[1],clientes)).toBe('Juan · …0002')
  })
  it('nunca convierte un nombre libre o id desconocido en una ficha', () => {
    expect(asociacionNota('__otro__',clientes,'Juan')).toEqual({cliente_id:null,paciente:'Juan'})
    expect(asociacionNota('8',clientes)).toBeNull()
    expect(asociacionNota('__general__',clientes)).toEqual({cliente_id:null,paciente:'General'})
    expect(asociacionNota('2',clientes)).toEqual({cliente_id:2,paciente:'Juan'})
  })
})
