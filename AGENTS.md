# AGENTS.md — Mapa de divulgación progresiva

Este archivo es el punto de entrada para cualquier agente que trabaje en agentic-crm.
No contiene todas las reglas — contiene el mapa para encontrarlas bajo demanda.

## Estructura del proyecto

```
app/                        ← raíz del repo git
├── CLAUDE.md               ← protocolo del Leader (leer primero)
├── AGENTS.md               ← este archivo
├── CHECKPOINTS.md          ← criterios de "feature terminada correctamente"
├── feature_list.json       ← alcance: una feature a la vez
├── init.sh                 ← verificación e inicialización
├── progress/
│   ├── current.md          ← plan vivo de la sesión activa
│   └── history.md          ← bitácora append-only
├── docs/
│   ├── architecture.md     ← arquitectura del CRM
│   ├── conventions.md      ← patrones de código obligatorios
│   └── verification.md     ← cómo demostrar que algo funciona
├── .claude/
│   ├── agents/             ← definiciones de subagentes
│   │   ├── leader.md
│   │   ├── implementer.md
│   │   └── reviewer.md
│   └── settings.json       ← hooks de verificación automática
└── src/                    ← código fuente Next.js (no tocar sin ser implementer)
```

## Quién hace qué

| Agente        | Puede editar `src/` | Puede editar `progress/` | Puede editar `feature_list.json` |
|---------------|---------------------|--------------------------|----------------------------------|
| Leader        | NO                  | SÍ                       | SÍ                               |
| Implementer   | SÍ                  | SÍ (impl_*.md)           | SÍ (pending→in_progress→done)    |
| Reviewer      | NO                  | SÍ (review_*.md)         | NO                               |

## Reglas universales

1. Una feature `in_progress` a la vez — `init.sh` rechaza más de una
2. Estado en disco, no en chat — los subagentes escriben archivos, devuelven referencias
3. No aprobar tu propio trabajo — el implementer no hace review
4. Verificación ejecutable — `init.sh` corre `tsc --noEmit`; el agente no puede fingir éxito
