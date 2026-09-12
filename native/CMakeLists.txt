cmake_minimum_required(VERSION 3.16)
project(boardssh C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

find_package(Threads REQUIRED)

if(NOT WOLF_PREFIX)
    set(WOLF_PREFIX "${CMAKE_SOURCE_DIR}/build/install")
endif()

if(WIN32)
    add_library(boardssh STATIC src/boardssh.c)
else()
    add_library(boardssh SHARED src/boardssh.c)
endif()

target_include_directories(boardssh
    PUBLIC "${CMAKE_SOURCE_DIR}/include"
    PRIVATE "${WOLF_PREFIX}/include")
target_compile_definitions(boardssh PRIVATE WOLFSSH_SCP WOLFSSH_TERM WOLFSSH_CERTS)
target_link_directories(boardssh PRIVATE "${WOLF_PREFIX}/lib")
target_link_libraries(boardssh PRIVATE wolfssh wolfssl Threads::Threads)

if(WIN32)
    target_link_libraries(boardssh PRIVATE ws2_32 crypt32)

    add_executable(wolfssh_cli main_windows.c)
    target_include_directories(wolfssh_cli PRIVATE "${CMAKE_SOURCE_DIR}/include")
    target_link_directories(wolfssh_cli PRIVATE "${WOLF_PREFIX}/lib")
    target_link_libraries(wolfssh_cli PRIVATE boardssh wolfssh wolfssl Threads::Threads ws2_32 crypt32)
    set_target_properties(wolfssh_cli PROPERTIES OUTPUT_NAME wolfssh)
else()
    set_target_properties(boardssh PROPERTIES
        BUILD_WITH_INSTALL_RPATH TRUE
        INSTALL_RPATH "$ORIGIN")

    add_library(wolfcli_config STATIC src/ssh_config.c)
    target_include_directories(wolfcli_config PUBLIC "${CMAKE_SOURCE_DIR}/include")

    add_executable(wolfssh_cli main.c)
    target_include_directories(wolfssh_cli PRIVATE "${CMAKE_SOURCE_DIR}/include")
    target_link_directories(wolfssh_cli PRIVATE "${WOLF_PREFIX}/lib")
    target_link_libraries(wolfssh_cli PRIVATE boardssh wolfcli_config wolfssh wolfssl)
    set_target_properties(wolfssh_cli PROPERTIES
        OUTPUT_NAME wolfssh
        BUILD_WITH_INSTALL_RPATH TRUE
        INSTALL_RPATH "$ORIGIN/../lib")

    add_executable(wolfscp main.c)
    target_include_directories(wolfscp PRIVATE "${CMAKE_SOURCE_DIR}/include")
    target_link_directories(wolfscp PRIVATE "${WOLF_PREFIX}/lib")
    target_link_libraries(wolfscp PRIVATE boardssh wolfcli_config wolfssh wolfssl)
    set_target_properties(wolfscp PROPERTIES
        BUILD_WITH_INSTALL_RPATH TRUE
        INSTALL_RPATH "$ORIGIN/../lib")
endif()
