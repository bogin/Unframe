import { Module, ActionContext } from 'vuex'
import axios from 'axios'
import { FilesState, File } from '@/types/files'
import { RootState } from '@/types'

type FilesActionContext = ActionContext<FilesState, RootState>

interface FetchFilesPayload {
  page?: number
  size?: number
  filters?: {
    modifiedTime?: string
    query?: string
    [key: string]: unknown
  }
}

interface FetchFilesResponse {
  files?: File[]
  pagination?: {
    currentPage: number
    pageSize: number
    totalItems: number
    totalPages: number
    hasNextPage: boolean
  }
  error?: string
}

const files: Module<FilesState, RootState> = {
  namespaced: true,

  state: {
    items: [],
    currentFile: null,
    loading: false,
    pagination: {
      currentPage: 1,
      pageSize: 10,
      totalItems: 0,
      totalPages: 0,
      hasNextPage: false,
    },
    error: null,
  },

  mutations: {
    SET_FILES(state, { files, pagination }) {
      state.items = files
      state.pagination = pagination
    },
    SET_CURRENT_FILE(state, file: File | null) {
      state.currentFile = file
    },
    SET_LOADING(state, status: boolean) {
      state.loading = status
    },
    SET_ERROR(state, error: string | null) {
      state.error = error
    },
  },

  actions: {
    async fetchFiles(
      { commit }: FilesActionContext,
      payload: FetchFilesPayload = {}
    ) {
      commit('SET_LOADING', true)
      try {
        const response = await axios.post<FetchFilesResponse>('/files', {
          page: payload.page || 1,
          size: payload.size || 10,
          filters: payload.filters
            ? JSON.stringify(payload.filters)
            : undefined,
        })

        if (response.data.error) {
          commit('SET_ERROR', response.data.error)
          commit('SET_LOADING', false)
          return
        } else {
          commit('SET_ERROR', null)
        }
        commit('SET_FILES', {
          files: response.data.files,
          pagination: response.data.pagination,
        })

        return response.data
      } catch (error) {
        commit(
          'SET_ERROR',
          error instanceof Error ? error.message : 'Unknown error'
        )
      } finally {
        commit('SET_LOADING', false)
      }
    },

    async fetchFileById({ commit }: FilesActionContext, fileId: string) {
      commit('SET_LOADING', true)
      try {
        const response = await axios.get<File>(`/files/${fileId}`)
        commit('SET_CURRENT_FILE', response.data)
        return response.data
      } catch (error) {
        commit(
          'SET_ERROR',
          error instanceof Error ? error.message : 'Unknown error'
        )
        commit('SET_CURRENT_FILE', null)
        throw error
      } finally {
        commit('SET_LOADING', false)
      }
    },

    async deleteFile({ dispatch }: FilesActionContext, fileId: string) {
      try {
        await axios.delete(`/files/${fileId}`)
        return dispatch('fetchFiles', { page: 1 })
      } catch (error) {
        console.error('Failed to delete file:')
        throw error
      }
    },

    async updateFile(
      { dispatch }: FilesActionContext,
      { fileId, data }: { fileId: string; data: Partial<File> }
    ) {
      try {
        await axios.put(`/files/${fileId}`, data)
        return dispatch('fetchFiles', { page: 1 })
      } catch (error) {
        console.error('Failed to update file:')
        throw error
      }
    },
  },
}

export default files
