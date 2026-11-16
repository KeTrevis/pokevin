// @ts-check
const API = 'https://qglircqqrtgdvxawisoz.supabase.co';
// Public client key from the game's bundle; authorization uses the player's session.
const KEY = 'sb_publishable_BCiE_porcfjQJ-a7-H5tIA_uj_MriW8';
const SESSION = 'sb-qglircqqrtgdvxawisoz-auth-token';

/** @param {string} uid @param {AbortSignal} signal */
export async function loadFriendDex(uid, signal) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid)) {
    throw new Error('Identifiant d’ami invalide.');
  }
  let session;
  try { session = JSON.parse(localStorage.getItem(SESSION) || 'null'); } catch {}
  if (typeof session?.access_token !== 'string' || !session.access_token) {
    throw new Error('Connecte-toi au jeu pour consulter tes amis.');
  }
  const response = await fetch(`${API}/rest/v1/rpc/friend_card`, {
    method: 'POST', signal,
    headers: { apikey: KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ other: uid }),
  });
  if (response.status === 401) throw new Error('Session expirée. Reconnecte-toi au jeu puis réessaie.');
  if (!response.ok) throw new Error('Impossible de charger ce Pokédex. Réessaie plus tard.');
  const card = await response.json();
  if (!card || !Array.isArray(card.dex) || card.dex.some(/** @param {unknown} id */ id =>
    !(typeof id === 'number' || typeof id === 'string' && /^\d+$/.test(id)) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) {
    throw new Error('Pokédex inaccessible ou réponse du jeu incompatible.');
  }
  return /** @type {number[]} */ (card.dex.map(Number));
}
