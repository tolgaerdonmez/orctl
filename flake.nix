{
  description = "orctl: OpenRouter management CLI + TUI";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      version = (builtins.fromJSON (builtins.readFile ./package.json)).version;

      # bun2nix does not read Bun 1.4's lockfile v2 yet, so dependencies are fetched by a
      # fixed-output derivation instead (plan §11.2 fallback). `--os="*" --cpu="*"` installs the
      # native OpenTUI package for every platform, so one hash serves all systems.
      # After changing bun.lock: set outputHash to lib.fakeHash, build, paste the reported hash.
      nodeModules =
        pkgs:
        pkgs.stdenvNoCC.mkDerivation {
          pname = "orctl-node-modules";
          inherit version;
          src = pkgs.lib.fileset.toSource {
            root = ./.;
            fileset = pkgs.lib.fileset.unions [
              ./package.json
              ./bun.lock
            ];
          };
          nativeBuildInputs = [ pkgs.bun ];
          dontConfigure = true;
          buildPhase = ''
            runHook preBuild
            export HOME=$TMPDIR
            export BUN_INSTALL_CACHE_DIR=$TMPDIR/bun-cache
            bun install --frozen-lockfile --ignore-scripts --no-progress --os="*" --cpu="*"
            runHook postBuild
          '';
          installPhase = ''
            runHook preInstall
            mkdir -p $out
            cp -R node_modules $out/
            runHook postInstall
          '';
          dontFixup = true;
          outputHashMode = "recursive";
          outputHashAlgo = "sha256";
          outputHash = "sha256-J9tfQ6SUBsA2Qu7eeYiDFW3Ze3x/p73tBcMhJ/fU6+Y=";
        };

      orctl =
        pkgs:
        pkgs.stdenvNoCC.mkDerivation {
          pname = "orctl";
          inherit version;
          src = pkgs.lib.fileset.toSource {
            root = ./.;
            fileset = pkgs.lib.fileset.unions [
              ./package.json
              ./bun.lock
              ./tsconfig.json
              ./src
            ];
          };
          nativeBuildInputs = [ pkgs.bun ];
          dontConfigure = true;
          buildPhase = ''
            runHook preBuild
            export HOME=$TMPDIR
            cp -R ${nodeModules pkgs}/node_modules ./node_modules
            chmod -R u+w node_modules
            # No --bytecode: OpenTUI's core has an asynchronous ESM graph (plan §11.1).
            bun build --compile src/main.ts --outfile orctl
            runHook postBuild
          '';
          installPhase = ''
            runHook preInstall
            install -Dm755 orctl $out/bin/orctl
            runHook postInstall
          '';
          # Bun-compiled executables carry their payload after the binary; stripping breaks them.
          dontStrip = true;
          dontPatchELF = true;
          meta = {
            description = "OpenRouter management CLI + TUI";
            homepage = "https://github.com/tolgaerdonmez/orctl";
            license = pkgs.lib.licenses.mit;
            mainProgram = "orctl";
          };
        };
    in
    {
      packages = forAllSystems (pkgs: {
        default = orctl pkgs;
        orctl = orctl pkgs;
      });

      apps = forAllSystems (pkgs: {
        default = {
          type = "app";
          program = "${orctl pkgs}/bin/orctl";
        };
      });

      devShells = forAllSystems (pkgs: {
        # TypeScript and Biome come pinned from package.json via `bun install`.
        default = pkgs.mkShell { packages = [ pkgs.bun ]; };
      });
    };
}
