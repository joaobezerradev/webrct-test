import { ADD_PEER, REMOVE_PEER } from "./peerActions";

export type PeerState = Record<string, { stream: MediaStream }>;

interface AddPeerAction {
  type: typeof ADD_PEER;
  payload: { peerId: string; stream: MediaStream };
}

interface RemovePeerAction {
  type: typeof REMOVE_PEER;
  payload: { peerId: string };
}

type PeerAction = AddPeerAction | RemovePeerAction;

export const peerReducer = (state: PeerState, action: PeerAction): PeerState => {
  switch (action.type) {
    case ADD_PEER:
      return {
        ...state,
        [action.payload.peerId]: { stream: action.payload.stream }
      };

    case REMOVE_PEER:
      const { [action.payload.peerId]: _, ...rest } = state;
      return rest;

    default:
      return state;
  }
};
