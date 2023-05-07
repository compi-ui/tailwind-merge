import { EMPTY, MatchContext, MatchValue } from './lib/shared'
import { isNumericValue } from './lib/utils'

export type RuleMemory<T = any> = Record<string | symbol, T>

export type Handler<T = any> = (
    memory: RuleMemory<T>,
    data: { context: MatchContext; value: MatchValue; match: RegExpMatchArray },
) => boolean | 'continue' // keep class | continue to next rule

export type Rule = [string, Handler]
export type RuleSet = Rule[]

export const CONTEXT_REGEXP = '(?<context>.*%SEPARATOR%!?|!?)?-?%PREFIX%'
export const TRAILING_SLASH_REGEXP = '(?:\\/[0-9]+)?'

// simple rule
// -----------

export type SimpleHandlerOptions = {
    byType?: boolean
}

export function createSimpleHandler({ byType }: SimpleHandlerOptions = {}) {
    const simpleHandler: Handler<Record<string, Partial<Record<'number' | 'other', boolean>>>> = (
        memory,
        { context, value, match },
    ) => {
        const target = match.groups?.target!
        const type = byType && isNumericValue(value) ? 'number' : 'other'
        memory[context] ??= {}
        memory[context]![target] ??= {}
        const mem = memory[context]![target]!

        // seen before
        if (mem[type]) return false

        // never seen
        mem[type] = true
        return true
    }

    return simpleHandler
}

export type SimpleRuleOptions = {
    /** Whether the rule supports a default value (no value, e.g. `border`) */
    def?: boolean
    /** Whether the rule supports a trailing slash (e.g. `text-red-500/50`) */
    slash?: boolean
} & SimpleHandlerOptions

export function simpleRule(target: string, { def, slash, byType }: SimpleRuleOptions = {}): Rule {
    const value = def ? '(?:-(?<value>.*))?' : '-(?<value>.+)'
    const trailingSlash = slash ? TRAILING_SLASH_REGEXP : ''
    const regExp = `^${CONTEXT_REGEXP}(?<target>${target})${value}${trailingSlash}$`
    return [regExp, createSimpleHandler({ byType })]
}

// cardinal rule
// -------------

export type CardinalHandlerOptions = {
    overrides?: Partial<Record<string | typeof EMPTY, (string | typeof EMPTY)[]>>
    byType?: boolean
}

type Direction = string | typeof EMPTY

const OVERRIDERS = Symbol('overriders')

export function createCardinalHandler({ overrides = {}, byType }: CardinalHandlerOptions = {}) {
    const overriders = new Set(Object.values(overrides).flat())
    const cardinalHandler: Handler<
        Partial<Record<Direction, Partial<Record<'number' | 'other', boolean>>>> & {
            [OVERRIDERS]?: Partial<Record<'number' | 'other', Set<string | typeof EMPTY>>>
        }
    > = (memory, { context, value, match }) => {
        const direction = match.groups?.direction || EMPTY
        const type = byType && isNumericValue(value) ? 'number' : 'other'
        memory[context] ??= {}
        memory[context]![direction] ??= {}
        const mem = memory[context]![direction]!

        // seen before
        if (mem[type]) return false

        // apply override
        memory[context]![OVERRIDERS] ??= {}
        memory[context]![OVERRIDERS]![type] ??= new Set()
        const memOverriders = memory[context]![OVERRIDERS]![type]!
        if (overrides[direction]?.some(memOverriders.has.bind(memOverriders))) return false

        // remember overrider
        if (overriders.has(direction)) memOverriders.add(direction)

        // never seen
        mem[type] = true
        return true
    }

    return cardinalHandler
}

export type CardinalRuleOptions = {
    /** Whether the rule supports a default value (no value, e.g. `border`) */
    def?: boolean
    /** Whether the direction is dash-separated (e.g. `border-t-2`) */
    dash?: boolean
    /** The allowed directions (e.g. `t|r|b|l`) */
    dir?: string
    /** Whether the rule supports a trailing slash (e.g. `text-red-500/50`) */
    slash?: boolean
} & CardinalHandlerOptions

export function cardinalRule(
    target: string,
    { def, dash, dir, slash, overrides, byType }: CardinalRuleOptions = {},
): Rule {
    const value = def ? '(?:-(?<value>.*))?' : '-(?<value>.+)'
    const _target = `${target}(?:${dash ? '-' : ''}(?<direction>${dir}))?`
    const trailingSlash = slash ? TRAILING_SLASH_REGEXP : ''
    const regExp = `^${CONTEXT_REGEXP}${_target}${value}${trailingSlash}$`
    return [regExp, createCardinalHandler({ overrides, byType })]
}

export function cardinalRules(targets: string, options?: CardinalRuleOptions) {
    const _targets = targets.split('|')
    return _targets.map((target) => cardinalRule(target, options))
}

// unique rule
// -----------

export function createUniqueHandler() {
    const uniqueValueHandler: Handler<boolean> = (memory, { context }) => {
        if (memory[context]) return false
        memory[context] = true
        return true
    }
    return uniqueValueHandler
}

export type UniqueRuleOptions = {
    prefix?: string
    /** Whether the rule supports a trailing slash (e.g. `text-red-500/50`) */
    slash?: boolean
}

export function uniqueRule(values: string, { prefix, slash }: UniqueRuleOptions = {}): Rule {
    const _prefix = prefix ? `${prefix}-` : ''
    const trailingSlash = slash ? TRAILING_SLASH_REGEXP : ''
    const regExp = `^${CONTEXT_REGEXP}${_prefix}(${values})${trailingSlash}$`
    return [regExp, createUniqueHandler()]
}

export function uniqueRules(targets: string[], options?: UniqueRuleOptions) {
    return targets.map((target) => uniqueRule(target, options))
}

// arbitrary rule
// --------------

export function createArbitraryHandler() {
    const arbitraryHandler: Handler<Record<string, { done?: boolean }>> = (
        memory,
        { context, match },
    ) => {
        const property = match.groups?.property!

        memory[context] ??= {}
        memory[context]![property] ??= {}
        const mem = memory[context]![property]!

        // seen before
        if (mem.done) return false

        // never seen
        mem.done = true
        return true
    }

    return arbitraryHandler
}

export function arbitraryRule(): Rule {
    return [`^${CONTEXT_REGEXP}\\[(?<property>.+?):(?<value>.*)\\]$`, createArbitraryHandler()]
}

// conflict rule
// -------------

export type ConflictRuleTargets = Record<string, string>

export function createConflictHandler(targets: ConflictRuleTargets) {
    const overridableMap: Record<string, string[]> = {}
    Object.entries(targets).forEach(([overridingUtility, overridableUtilities]) =>
        overridableUtilities.split('|').forEach((value) => {
            overridableMap[value] ??= []
            overridableMap[value]!.push(overridingUtility)
        }),
    )

    const conflictHandler: Handler<Record<string, boolean>> = (memory, { context, match }) => {
        const utility = match.groups?.utility!
        memory[context] ??= {}
        const mem = memory[context]!

        // is overridable utility and overriding utility has been seen
        const skipClass = Boolean(
            utility in overridableMap && overridableMap[utility]!.some((u) => mem[u]),
        )
        if (skipClass) return false

        // is overriding utility
        if (utility in targets) mem[utility] = true

        // continue evaluating other rules
        return 'continue'
    }

    return conflictHandler
}

export function conflictRule(targets: ConflictRuleTargets): Rule {
    const overridingUtilities = Object.keys(targets)
    const overridableUtilities = Object.values(targets).join('|').split('|')
    const matchingClasses = [...overridingUtilities, ...overridableUtilities]
    const utility = `(?<utility>${matchingClasses.join('|')})`
    const value = '(?:-(?<value>.*))?'
    const regExp = `^${CONTEXT_REGEXP}${utility}${value}$`
    return [regExp, createConflictHandler(targets)]
}
