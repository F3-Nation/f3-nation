#!/usr/bin/env bash

# Stop and remove all running containers
if [ "$(docker ps -q)" ]; then
  docker stop $(docker ps -q)
  docker rm $(docker ps -a -q)
else
  echo "No running containers to stop or remove."
fi

# Remove all images
if [ "$(docker images -q)" ]; then
  docker rmi $(docker images -q)
else
  echo "No images to remove."
fi

# Remove all volumes
if [ "$(docker volume ls -q)" ]; then
  docker volume rm $(docker volume ls -q)
else
  echo "No volumes to remove."
fi

# Remove all networks except the default ones
networks_to_remove=$(docker network ls -q | grep -vE 'bridge|host|none')
if [ "$networks_to_remove" ]; then
  docker network rm $networks_to_remove 2>/dev/null || true
else
  echo "No custom networks to remove."
fi

# Exit successfully
exit 0
