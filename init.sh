#!/usr/bin/env bash
# init.sh — Verificación e inicialización del arnés agentic-crm
# Debe terminar en verde para que el Leader pueda iniciar una sesión

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }
warn() { echo -e "${YELLOW}!${NC} $1"; }

echo ""
echo "━━━ agentic-crm init check ━━━"
echo ""

# 1. Node modules
if [ -d "node_modules" ]; then
  ok "node_modules presente"
else
  warn "node_modules no encontrado — corriendo npm install..."
  npm install --silent || fail "npm install falló"
  ok "node_modules instalado"
fi

# 2. Variables de entorno
if [ -f ".env.local" ]; then
  ok ".env.local presente"
else
  fail ".env.local no encontrado — copia .env.example y llena las variables"
fi

# 3. feature_list.json — máximo un in_progress
IN_PROGRESS=$(node -e "
  const f = require('./feature_list.json');
  const n = f.filter(x => x.status === 'in_progress').length;
  console.log(n);
")

if [ "$IN_PROGRESS" -gt "1" ]; then
  fail "Hay $IN_PROGRESS features in_progress — solo se permite 1 a la vez"
elif [ "$IN_PROGRESS" -eq "1" ]; then
  TITLE=$(node -e "
    const f = require('./feature_list.json');
    const x = f.find(x => x.status === 'in_progress');
    console.log(x.title);
  ")
  warn "Feature en progreso: $TITLE"
else
  PENDING=$(node -e "
    const f = require('./feature_list.json');
    const n = f.filter(x => x.status === 'pending').length;
    console.log(n);
  ")
  ok "$PENDING features pendientes"
fi

# 4. TypeScript
echo ""
echo "Verificando TypeScript..."
if npx tsc --noEmit 2>&1 | grep -q "error TS"; then
  fail "TypeScript tiene errores — corre: npx tsc --noEmit"
else
  ok "TypeScript limpio"
fi

# 5. Directorios de progreso
mkdir -p progress docs .claude/agents

if [ ! -f "progress/current.md" ]; then
  echo "# Sesión activa\n\nSin sesión iniciada." > progress/current.md
fi

if [ ! -f "progress/history.md" ]; then
  echo "# Historial de sesiones\n\n_Sin entradas aún._" > progress/history.md
fi

ok "Directorios de progreso listos"

echo ""
echo -e "${GREEN}━━━ Init OK — Leader puede iniciar sesión ━━━${NC}"
echo ""

# Mostrar siguiente feature
NEXT=$(node -e "
  const f = require('./feature_list.json');
  const x = f.find(x => x.status === 'pending' || x.status === 'in_progress');
  if (x) console.log('[' + x.status.toUpperCase() + '] ' + x.title);
  else console.log('Todas las features completadas');
")
echo "Siguiente: $NEXT"
echo ""
