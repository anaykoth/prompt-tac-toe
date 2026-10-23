// Lobby membership is separate from a game's playing seats. Games opt into
// a team shape; no shared service assumes two players or one match per room.
export function matchRoster(teamSizes = [1, 1]) {
  if (
    !Array.isArray(teamSizes) ||
    teamSizes.length < 2 ||
    teamSizes.length > 4 ||
    teamSizes.some((n) => !Number.isInteger(n) || n < 1 || n > 8) ||
    teamSizes.reduce((a, b) => a + b, 0) > 24
  )
    throw Error('Invalid team sizes');
  const slots = [];
  for (let member = 0; member < Math.max(...teamSizes); member++) {
    teamSizes.forEach((size, team) => {
      if (member < size) slots.push({ seat: slots.length, team, playerId: null });
    });
  }
  return slots;
}
export function createMatch({ id, game = 'hockey', teamSizes = [1, 1] }) {
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(id)) throw Error('Invalid match id');
  return { id, game, teamSizes: [...teamSizes], roster: matchRoster(teamSizes) };
}
