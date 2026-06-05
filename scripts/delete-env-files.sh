#!/bin/bash

echo "Searching for files to delete..."
echo "--------------------------------"

# 1. Run the preview command and store the output
files_to_delete=$(find . -type d \( -name "node_modules" -o -name ".turbo" -o -name "coverage" -o -name ".next" \) -prune -o \( -name ".env" -o -name ".env.bak.*" \) -type f -print)

# 2. Check if any matching files were actually found
if [ -z "$files_to_delete" ]; then
    echo "No matching files found. Nothing to do."
    exit 0
fi

# 3. Print the list of files found
echo "$files_to_delete"
echo "--------------------------------"

# 4. Prompt the user for confirmation (defaulting to No)
read -r -p "Do you want to permanently delete these files? [y/N]: " response

# 5. Convert response to lowercase and check for "y" or "yes"
response=$(echo "$response" | tr '[:upper:]' '[:lower:]')

if [[ "$response" == "y" || "$response" == "yes" ]]; then
    echo "Deleting files..."
    find . -type d \( -name "node_modules" -o -name ".turbo" -o -name "coverage" -o -name ".next" \) -prune -o \( -name ".env" -o -name ".env.bak.*" \) -type f -delete
    echo "Deletion complete."
else
    echo "Operation canceled. No files were deleted."
fi
