import type { Template } from '../templates/Template.js'

export type CurrentTemplateSlice = { currentTemplate: Template | null }

export function createCurrentTemplateSlice(): CurrentTemplateSlice {
	return { currentTemplate: null }
}
