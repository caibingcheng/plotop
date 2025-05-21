PLATFORM ?= linux
CROSSCOMPILER ?=

# Compiler
CXX := $(CROSSCOMPILER)g++

# Compiler flags
CXXFLAGS := -std=c++17 -Wall -static

# Linker flags
LDFLAGS := -lstdc++fs -pthread -static-libstdc++ -static-libgcc

INC := -Iclient/${PLATFORM} -Iclient

# Target executable
TARGET := plotop

# Build directories
BUILD_DIR := build

# Source files
SRC := $(wildcard client/*.cc) $(wildcard client/${PLATFORM}/*.cc) $(wildcard client/${PLATFORM}/*.cpp) $(wildcard client/${PLATFORM}/*.cc)

# Object files
OBJ := $(SRC:%=$(BUILD_DIR)/%.o)

# Dependency files
DEP := $(OBJ:.o=.d)

# Include dependency files
-include $(DEP)

# Default target
all: $(BUILD_DIR)/$(TARGET)
	cp $(BUILD_DIR)/$(TARGET) .

# Link target
$(BUILD_DIR)/$(TARGET): $(OBJ)
	@mkdir -p $(@D)
	$(CXX) $(CXXFLAGS) $(INC) $^ -o $@ $(LDFLAGS)

# Compile target
$(BUILD_DIR)/%.cc.o: %.cc
	@mkdir -p $(@D)
	$(CXX) $(CXXFLAGS) $(INC) -MMD -c $< -o $@

# Clean target
clean:
	@rm -rf $(BUILD_DIR)

# Phony targets
.PHONY: all clean

# set default make all
.DEFAULT_GOAL := all
