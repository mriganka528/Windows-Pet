import type {
  CharacterId,
  ColorThemeId,
  NaturalCoatId,
  SpritePalette
} from '../../../shared/settings'
import { COLOR_THEMES, isNaturalCoat, THEME_LABELS } from '../../../shared/settings'
import type { SpeciesDef } from './species'

interface CoatSeed {
  label: string
  fur: string
  cream: string
  marks?: string
}
type Variants = Record<Exclude<NaturalCoatId, 'natural'>, CoatSeed>
const seed = (label: string, fur: string, cream = '#F4EAD9', marks?: string): CoatSeed => ({
  label,
  fur,
  cream,
  marks
})
const variants = (light: CoatSeed, dark: CoatSeed, warm: CoatSeed): Variants => ({
  'natural-light': light,
  'natural-dark': dark,
  'natural-warm': warm
})

/** Animal-specific choices retain the species' recognizable markings. */
export const NATURAL_COATS: Record<CharacterId, Variants> = {
  cat: variants(
    seed('Cream tabby', '#DEC6A0'),
    seed('Smoke tabby', '#7B838B', '#D6DADB'),
    seed('Chocolate tabby', '#96745C')
  ),
  dog: variants(
    seed('Cream', '#DDC59E'),
    seed('Black', '#464B50', '#B8B8AA'),
    seed('Chocolate', '#805B44')
  ),
  fox: variants(
    seed('Arctic white', '#E5E5DC', '#FFFFFF', '#65686A'),
    seed('Silver fox', '#7B8183', '#DEE0D9'),
    seed('Sandy fox', '#D2B081', '#FAEDD4')
  ),
  bunny: variants(
    seed('Cream bunny', '#E8D7B6'),
    seed('Slate bunny', '#79828D', '#CBD2D8'),
    seed('Cocoa bunny', '#AD8B73')
  ),
  panda: variants(
    seed('Ivory panda', '#EAE2CD', '#FFF8E7'),
    seed('Silver panda', '#CBD3D4', '#EBF0EE'),
    seed('Brown panda', '#E7D6BD', '#F5E8D2', '#876047')
  ),
  bear: variants(
    seed('Polar white', '#E5E1D4', '#FBF9ED'),
    seed('Black bear', '#4C4842', '#BFA991'),
    seed('Cinnamon bear', '#AA7048', '#DFBE93')
  ),
  penguin: variants(
    seed('Silver penguin', '#88939D', '#F8FAF5'),
    seed('Midnight penguin', '#283643', '#F1F4ED'),
    seed('Brown penguin', '#8C796A', '#E9E5DD')
  ),
  redpanda: variants(
    seed('Apricot panda', '#D79969', '#FFF1DB', '#75503A'),
    seed('Sable panda', '#8C533A', '#E9D6BA', '#3F3029'),
    seed('Copper panda', '#B45D32', '#F3D8AD', '#63402B')
  ),
  hamster: variants(
    seed('Ivory hamster', '#DCD5C3', '#FFFFFF'),
    seed('Grey hamster', '#929393', '#E6E5DC'),
    seed('Honey hamster', '#C99D53', '#F9E8BB')
  ),
  frog: variants(
    seed('Golden frog', '#D3BA52', '#FCF2C0'),
    seed('Forest frog', '#56885A', '#D8E2BA'),
    seed('Blue frog', '#62A3AD', '#D5EDF0')
  ),
  tiger: variants(
    seed('White tiger', '#DFE1DE', '#FFFFFF', '#4B5053'),
    seed('Umber tiger', '#AF865D', '#F5E6CF', '#49382A'),
    seed('Golden tiger', '#DEBE7A', '#FFF0CA', '#966231')
  ),
  koala: variants(
    seed('Silver koala', '#C3CDD0', '#EEF4EE'),
    seed('Charcoal koala', '#737D86', '#D4DFDF'),
    seed('Taupe koala', '#A79C8D', '#E8E1D2')
  ),
  pig: variants(
    seed('Peach pig', '#EDC3AE', '#FFE5D9'),
    seed('Slate pig', '#7C8085', '#CFCDD0'),
    seed('Rosy pig', '#C58D89', '#EBC6BF')
  ),
  mouse: variants(
    seed('White mouse', '#E7E5DB', '#FFFFFF'),
    seed('Grey mouse', '#7C8591', '#DFE5E5'),
    seed('Brown mouse', '#AD9170', '#EEDFC5')
  ),
  chick: variants(
    seed('Cream chick', '#F1E1AC', '#FFF8D9'),
    seed('Dusky chick', '#918478', '#E6D9C0'),
    seed('Ginger chick', '#DFA454', '#FCE6AE')
  )
}

function mix(hex: string, target: string, amount: number): string {
  const channels = [1, 3, 5].map((i) =>
    Math.round(
      parseInt(hex.slice(i, i + 2), 16) * (1 - amount) +
        parseInt(target.slice(i, i + 2), 16) * amount
    )
      .toString(16)
      .padStart(2, '0')
  )
  return '#' + channels.join('')
}

export function coatPalette(sp: SpeciesDef, id: ColorThemeId): SpritePalette {
  if (!isNaturalCoat(id)) return COLOR_THEMES[id] ?? sp.palette
  if (id === 'natural') return sp.palette
  const coat = NATURAL_COATS[sp.id][id]
  return {
    fur: coat.fur,
    furLight: mix(coat.fur, '#FFFFFF', 0.28),
    furDark: mix(coat.fur, '#201D19', 0.22),
    furDarkest: mix(coat.fur, '#201D19', 0.42),
    cream: coat.cream,
    creamDark: mix(coat.cream, coat.fur, 0.18),
    earInner: sp.palette.earInner,
    outline: sp.palette.outline
  }
}

export function coatLabel(sp: SpeciesDef, id: ColorThemeId): string {
  return isNaturalCoat(id) && id !== 'natural' ? NATURAL_COATS[sp.id][id].label : THEME_LABELS[id]
}

/** Recolor socks and tail tips with the coat; keep noses and eye colors legible. */
export function speciesWithCoat(sp: SpeciesDef, id: ColorThemeId): SpeciesDef {
  const palette = coatPalette(sp, id)
  const marks =
    isNaturalCoat(id) && id !== 'natural'
      ? (NATURAL_COATS[sp.id][id].marks ?? sp.markColor)
      : sp.markColor
  const recolor = (color: string | undefined): string | undefined => {
    if (!color) return color
    if (color === sp.markColor) return marks
    if (color === sp.palette.cream) return palette.cream
    if (color === sp.palette.fur) return palette.fur
    if (color === sp.palette.furDark) return palette.furDark
    return color
  }
  return {
    ...sp,
    palette,
    markColor: marks,
    pawColor: recolor(sp.pawColor),
    tailAccent: recolor(sp.tailAccent),
    bellyColor: recolor(sp.bellyColor)
  }
}
