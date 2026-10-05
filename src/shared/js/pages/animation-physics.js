export const kickLogo = (state, cell, column, row, clickX, clickY) => {
  const offset = cell * 4
  const horizontal = column + 0.5 + state[offset] - clickX
  const vertical = row + 0.5 + state[offset + 1] - clickY
  const distance = Math.hypot(horizontal, vertical)
  const speed = 360 + 900 / (1 + distance / 12)

  state[offset + 2] += (distance ? horizontal / distance : 1) * speed
  state[offset + 3] += (distance ? vertical / distance : 0) * speed
  const velocity = Math.hypot(state[offset + 2], state[offset + 3])

  if (velocity > 1800) {
    state[offset + 2] *= 1800 / velocity
    state[offset + 3] *= 1800 / velocity
  }
}

export const stepPhysics = (state, elapsed, targets) => {
  const steps = Math.ceil(Math.min(elapsed, 0.05) * 120)
  const delta = Math.min(elapsed, 0.05) / steps

  for (let step = 0; step < steps; step++) {
    for (let offset = 0; offset < state.length; offset += 4) {
      for (let axis = 0; axis < 2; axis++) {
        const position = offset + axis
        const velocity = position + 2

        const target = targets?.[offset / 2 + axis] ?? 0
        const acceleration = 144 * (target - state[position]) -
          18 * state[velocity]

        state[velocity] += acceleration * delta
        state[position] += state[velocity] * delta
        if (Math.abs(state[position] - target) +
          Math.abs(state[velocity]) < 0.001) {
          state[position] = target
          state[velocity] = 0
        }
      }
    }
  }
}

export const transferPhysics = (state, next, logos) => {
  next.fill(0)
  for (const [source, target] of logos) {
    if (target < 0) {
      continue
    }
    const cell = source < 0 ? target : source

    for (let axis = 0; axis < 4; axis++) {
      next[target * 4 + axis] = state[cell * 4 + axis]
    }
  }
}
