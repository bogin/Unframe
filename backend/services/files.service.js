const filesRepository = require('../repo/files.repository');

const DEFAULTS = {
  page: 1,
  size: 10,
};

class FilesService {
  async listAllFiles(options = {}) {
    const page = options.page ? parseInt(options.page) : DEFAULTS.page;
    const size = options.size ? parseInt(options.size) : DEFAULTS.size;
  

    const results = await filesRepository.findAll({
      page,
      size,
      filters: options.filters
    });

    return results;
  }

  async getFileById(fileId) {
    // Add any additional business logic or validation
    return await filesRepository.findById(fileId);
  }

  async createFile(fileData) {
    // Perform any business logic validations
    // For example, check file size, type, or other constraints
    return await filesRepository.create(fileData);
  }

  async updateFileById(fileId, metadata) {
    // Add any business logic validations
    // For example, check update permissions, validate metadata
    return await filesRepository.update(fileId, metadata);
  }

  async deleteFileById(fileId) {
    // Add any business logic checks
    // For example, check deletion permissions
    return await filesRepository.delete(fileId);
  }
}

module.exports = new FilesService();