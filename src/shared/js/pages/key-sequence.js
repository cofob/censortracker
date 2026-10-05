export const mountKeySequence = (complete) => {
  const sequence = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown',
    'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a']
  let index = 0

  document.addEventListener('keydown', (event) => {
    if (event.repeat) {
      return
    }
    if (event.target.closest?.('input, textarea, select') || event.target.isContentEditable) {
      index = 0
      return
    }
    const key = event.key.toLowerCase()

    index = key === sequence[index] ? index + 1 : 0
    if (index === sequence.length) {
      index = 0
      complete()
    }
  })
}
