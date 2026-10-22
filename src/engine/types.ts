// Shared types of the framing engine. Rects are in source pixels unless named *Norm (0…1).

export interface Rect { x: number; y: number; w: number; h: number }

/** One detection of the current picture: the person's body box and, if found, the head. */
export interface Detection { body: Rect; head: Rect | null; score: number }

/** A tracked person with a stable id. */
export interface Person {
  id: number;
  body: Rect;
  head: Rect;
  /** head came from the face detector (true) or was estimated from the body box */
  faceSeen: boolean;
  firstSeen: number;
  lastSeen: number;
  hits: number;
  /** 0…1, how sure we are that this person is speaking right now */
  speaking: number;
  /** a name given in the UI or by the control API */
  label?: string;
}

/** Framing modes, named after what meeting-room cameras offer. */
export type Mode = 'overview' | 'group' | 'people' | 'speaker' | 'presenter';
/** Shot size per person (close-up … wide), like the presets of tracking PTZ cameras. */
export type Shot = 'close' | 'mcu' | 'medium' | 'cowboy' | 'wide';
export type Speed = 'slow' | 'normal' | 'fast';
export type Transition = 'smooth' | 'cut' | 'fade';
export type LayoutStyle = 'grid' | 'center' | 'speaker' | 'strip';

/** main: the speaker, else the presenter, else the largest person – for picture-in-picture */
export type TileRole = 'person' | 'overview' | 'group' | 'speaker' | 'main';
/** A tile of a layout, normalized to the output picture. */
export interface Tile { x: number; y: number; w: number; h: number; role: TileRole }
export interface Layout { id: string; name: string; tiles: Tile[] }

/** Everything that decides how the picture is framed. A scene (preset) stores one of these. */
export interface Framing {
  mode: Mode;
  shot: Shot;
  /** auto layout style, used when no custom layout is assigned for the person count */
  style: LayoutStyle;
  /** space above the head, share of the crop height (0…0.3) */
  headroom: number;
  /** extra margin around a group, share of its size (0…0.4) */
  padding: number;
  /** dead band: the crop only follows when the target moved more than this share (0…0.3) */
  deadband: number;
  speed: Speed;
  transition: Transition;
  /** seconds a person stays framed after the detector lost them */
  holdTime: number;
  /** most tiles; with more people the people mode falls back to group */
  maxPeople: number;
  /** sharpness guard: a tile never enlarges the source more than this factor */
  maxUpscale: number;
  /** speaker mode: seconds without a speaker before falling back to group */
  speakerFallback: number;
  highlightSpeaker: boolean;
  showLabels: boolean;
  /** a fixed layout (custom or template id) for every person count, e.g. a picture-in-picture */
  layout?: string | null;
}

/** A recallable scene, like a camera preset. */
export interface Scene { id: string; name: string; framing: Framing }

/** Where people count: the room boundary and zones that are ignored (glass walls, doors, screens). */
export interface RoomZones {
  boundary: Rect; // normalized
  exclusions: Rect[]; // normalized
  /** ignore heads smaller than this share of the picture height (people far away or outside) */
  minHead: number;
  /** speaker zones (seat microphones), normalized x ranges, switched by the control API */
  speakerZones: { name: string; x0: number; x1: number }[];
}
