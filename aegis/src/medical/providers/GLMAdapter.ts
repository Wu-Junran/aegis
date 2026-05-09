import {
	createOpenAICompatibleAdapter,
	__transformRequestForTest as oaiTxReq,
	__transformResponseForTest as oaiTxResp,
} from './OpenAICompatibleAdapter.js'
import type {
	AdapterRequest,
	AdapterRequestOptions,
	AdapterResponse,
	ProviderAdapter,
	ProviderConfig,
} from './ProviderAdapter.js'

const GLM_DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'

export function createGLMAdapter(): ProviderAdapter {
	const compat = createOpenAICompatibleAdapter('openai-compatible')
	return {
		id: 'glm',
		displayName: 'ZhipuAI GLM',
		async dispatch(
			request: AdapterRequest,
			config: ProviderConfig,
			opts?: AdapterRequestOptions,
		): Promise<AdapterResponse> {
			const effective: ProviderConfig = {
				...config,
				baseURL: config.baseURL ?? GLM_DEFAULT_BASE_URL,
			}
			// GLM is wire-compatible with OpenAI Chat Completions for v1; defer.
			return compat.dispatch(request, effective, opts)
		},
	}
}

// Re-export the OpenAICompatibleAdapter underscore helpers under the GLM
// adapter's surface. GLM v1 is a thin compat delegate with NO
// GLM-specific outbound transform, so these helpers ARE the OpenAI-compat
// transforms — re-exporting them here lets `GLMAdapter.test.ts` assert
// the compat-path contract end-to-end (i.e., "GLM dispatch produces the
// same wire body the OpenAI-compat transform would produce") without
// spinning up a network client. **Do NOT replace these re-exports with a
// GLM-specific transform**: the matrix and `GLMAdapter.test.ts` both
// expect the OpenAI wire shape; a custom transform would diverge from
// both. If a future GLM version requires a real divergence, introduce
// the GLM-specific transform as new exports alongside these (don't
// shadow them) and update the test to assert both surfaces.
export const __transformRequestForTest = oaiTxReq
export const __transformResponseForTest = oaiTxResp
