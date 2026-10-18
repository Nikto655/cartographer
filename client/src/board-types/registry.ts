import { graphBoardType } from './graph';
import { mapBoardType } from './map';
import type { BoardTypeDefinition } from './types';

/*
 * The one place core knows a world by name. A new world is one import line plus
 * one entry here — nothing scans directories, nothing loads dynamically (§1).
 */

const boardTypes: Record<string, BoardTypeDefinition> = {
  [mapBoardType.id]: mapBoardType,
  [graphBoardType.id]: graphBoardType,
};

/** Boards written before board types existed, and anything we don't know, are maps. */
const fallbackBoardType = mapBoardType;

export function resolveBoardType(boardType: string | undefined): BoardTypeDefinition {
  return (boardType && boardTypes[boardType]) || fallbackBoardType;
}

/** False when the board asked for a world we don't have — the UI says so quietly. */
export function isKnownBoardType(boardType: string | undefined): boolean {
  return !!boardType && boardType in boardTypes;
}

/**
 * Every world, in the order they should be offered when something new is made
 * (§3.4). Creation flows read this so they can offer a choice without core ever
 * naming a world.
 */
export function listBoardTypes(): BoardTypeDefinition[] {
  return Object.values(boardTypes);
}
