// Jest-friendly mock for MCP SDK Server
export const Server = jest.fn().mockImplementation(() => ({
  connect: jest.fn(),
  close: jest.fn(),
  setRequestHandler: jest.fn(),
}));

export default { Server };
