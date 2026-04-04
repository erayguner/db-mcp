// Jest-friendly mock for MCP SDK Stdio transport
export const StdioServerTransport = jest.fn().mockImplementation(() => ({
  close: jest.fn(),
}));

export default { StdioServerTransport };
