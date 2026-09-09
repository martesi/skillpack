{
  inputs.llm-agents.url = "git+https://github.com/numtide/llm-agents.nix?rev=7701789880274f13ff00946c17f8f51af06ab73b";

  outputs = { self, llm-agents, ... }:
    let
      system = "x86_64-linux";
      pkgs = llm-agents.inputs.nixpkgs.legacyPackages.${system};
      chromium = "${pkgs.chromium}/bin/chromium";
      devShell = pkgs.mkShell {
        packages = [
          pkgs.bun
          pkgs.chromium
          llm-agents.packages.${system}.agent-browser
        ];

        AGENT_BROWSER_EXECUTABLE_PATH = chromium;
        BUN_CHROME_PATH = chromium;
        FONTCONFIG_FILE = pkgs.makeFontsConf {
          fontDirectories = with pkgs; [ dejavu_fonts liberation_ttf ];
        };
      };
    in {
      devShells.${system} = {
        default = devShell;
        e2e = devShell;
      };
    };
}
