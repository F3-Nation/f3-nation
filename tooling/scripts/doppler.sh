#!/bin/bash

#
# doppler.sh
#
# This script is used to manage Doppler configurations.
#
# Usage:
#   doppler.sh <upload|download>
#
# Description:
#   - upload: Uploads the local configuration to the Doppler project.
#   - download: Downloads the remote configuration to the local machine.

# Function to check if Doppler and jq are installed and Doppler is logged in
check_dependencies() {
    if ! command -v doppler &> /dev/null; then
        echo "Doppler is not installed. Please install Doppler (brew install dopplerhq/cli/doppler), login, setup, and try again."
        exit 1
    fi

    if ! command -v jq &> /dev/null; then
        echo "jq is not installed. Please install jq (brew install jq) and try again."
        exit 1
    fi

    if ! doppler me > /dev/null 2>&1; then
        echo "Doppler is not logged in. Please run 'doppler login' then 'doppler setup' and try again."
        exit 1
    fi

		if ! doppler configs --json > /dev/null 2>&1; then
        echo "Doppler is not configured. Please run 'doppler setup' and try again."
        exit 1
    fi
}

# Color functions
blue() {
    printf '\033[1;34m%s\033[0m' "$1"
}

green() {
    printf '\033[32m%s\033[0m' "$1"
}

# Function to download configurations
download_configs() {
    local configs
    configs=$(doppler configs --json | jq -r '.[].name')
    
    for config in $configs; do
        local env_file=".env.${config}"
        local backup_file="${env_file}.backup"

        # Create a backup if the file exists
        if [ -f "$env_file" ]; then
            mv "$env_file" "$backup_file"
            backup_msg="Backed up existing file, "
        else
            backup_msg=""
        fi

        # Download the new configuration
        if doppler secrets download --no-file --format env --config "$config" > "$env_file"; then
            printf "Config %s: ${backup_msg}downloaded successfully to %s\n" "$(blue "$config")" "$(green "$env_file")"
            
            # If the config is 'dev' and .env doesn't exist, copy .env.dev to .env
            if [ "$config" == "dev" ] && [ ! -f ".env" ]; then
                cp "$env_file" ".env" && printf "Copied %s to %s\n" "$(green ".env.dev")" "$(green ".env")"
            fi
        else
            echo "Failed to download $config"
            # Restore the backup if it exists and the download failed
            [ -f "$backup_file" ] && mv "$backup_file" "$env_file" && echo "Restored backup for $env_file"
        fi
    done
}

# Function to upload configurations
upload_configs() {
    local configs
    configs=$(doppler configs --json | jq -r '.[].name')

    for config in $configs; do
        local env_file=".env.${config}"
        local backup_file="${env_file}.doppler"

        if [ ! -f "$env_file" ]; then
            printf "Config %s: %s does not exist. Skipping upload.\n" "$config" "$(green "$env_file")"
            continue
        fi

        # Create a backup of the current Doppler config
        if ! doppler secrets download --no-file --format env --config "$config" > "$backup_file"; then
            printf "Config %s: Failed to create backup. Skipping upload.\n" "$config"
            continue
        fi

        # Compare local file with Doppler config
        diff_output=$(diff -u "$backup_file" "$env_file")
        if [ -z "$diff_output" ]; then
            printf "Config %s: No differences found. Skipping upload.\n" "$config"
            rm "$backup_file"
            continue
        fi

        printf "Changes to be uploaded:\n"
        echo "$diff_output" | grep '^[-+]' | sed 's/^-/\x1b[31m-/;s/^+/\x1b[32m+/;s/$/\x1b[0m/'
        
        read -p "Do you want to proceed with the upload? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            printf "Upload cancelled for %s\n" "$(green "$env_file")"
            rm "$backup_file"
            continue
        fi

        # Upload the new configuration
        if doppler secrets upload "$env_file" --config "$config" --silent; then
            if [ "$config" == "dev" ]; then
                printf "Config %s: Successfully uploaded %s\n" "$(blue "$config")" "$(green "$env_file")"
            else
                printf "Config %s: Successfully uploaded %s\n" "$config" "$(green "$env_file")"
            fi
        else
            printf "Config %s: Failed to upload %s. Restoring previous configuration.\n" "$config" "$(green "$env_file")"
            if doppler secrets upload "$backup_file" --config "$config" --silent; then
                printf "Config %s: Successfully restored previous configuration\n" "$config"
            else
                printf "Config %s: Failed to restore previous configuration\n" "$config"
            fi
        fi

        rm "$backup_file"
    done
}

# Main script logic
if [ -z "$1" ]; then
    echo "Please specify an action (upload or download)."
    exit 1
fi

check_dependencies

if [ "$1" == "download" ]; then
    download_configs
elif [ "$1" == "upload" ]; then
    upload_configs
else
    echo "Invalid action. Please use 'upload' or 'download'."
    exit 1
fi